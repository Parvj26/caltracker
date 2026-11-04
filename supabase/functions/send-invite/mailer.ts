import nodemailer from 'nodemailer';

export interface Mailer {
  send(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

const RESEND_MAX_RETRIES = 3;
const RESEND_BACKOFF_MS = [500, 1000, 2000];

/** Delay before retrying a 429: the `retry-after` header (seconds) wins, else 500ms -> 1s -> 2s. */
function retryDelayMs(res: Response, attempt: number): number {
  const seconds = Number(res.headers.get('retry-after'));
  if (res.headers.get('retry-after') !== null && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  return RESEND_BACKOFF_MS[attempt] ?? 2000;
}

export function createResendMailer(opts: {
  apiKey: string;
  from: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Mailer {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async send(msg) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetchFn('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${opts.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ from: opts.from, ...msg }),
        });
        await res.body?.cancel();
        if (res.ok) return;
        // Resend allows 2 requests per second; back off and retry when it says slow down.
        if (res.status === 429 && attempt < RESEND_MAX_RETRIES) {
          await sleep(retryDelayMs(res, attempt));
          continue;
        }
        throw new Error(`Resend responded ${res.status}`);
      }
    },
  };
}

export function createMailer(env: {
  get(key: string): string | undefined;
}): Mailer {
  const from =
    env.get('INVITE_FROM_EMAIL') ?? 'CalTracker <invites@caltracker.app>';
  const resendKey = env.get('RESEND_API_KEY');

  if (resendKey) return createResendMailer({ apiKey: resendKey, from });

  // Local development: Supabase's mail catcher.
  const transport = nodemailer.createTransport({
    host: env.get('SMTP_HOST') ?? 'host.docker.internal',
    port: Number(env.get('SMTP_PORT') ?? '54325'),
    secure: false,
    ignoreTLS: true,
  });
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
  };
}
