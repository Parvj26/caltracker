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
/** Never sleep longer than this on a `retry-after`: the Edge Function has a hard wall-clock limit. */
const MAX_RETRY_WAIT_MS = 5000;

/** Delay before retrying a 429: the `retry-after` header (seconds, capped at 5 s) wins, else 500ms -> 1s -> 2s. */
function retryDelayMs(res: Response, attempt: number): number {
  const seconds = Number(res.headers.get('retry-after'));
  if (res.headers.get('retry-after') !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  }
  return RESEND_BACKOFF_MS[attempt] ?? 2000;
}

/**
 * A 429 can mean "slow down" (retry) or "daily/monthly quota used up" (waiting seconds will not help).
 * Resend's error JSON has a `name` such as `daily_quota_exceeded` and a `message`.
 */
function isQuotaExhausted(bodyText: string): boolean {
  try {
    const parsed = JSON.parse(bodyText) as { name?: unknown; message?: unknown };
    const text = `${typeof parsed.name === 'string' ? parsed.name : ''} ${typeof parsed.message === 'string' ? parsed.message : ''}`;
    return /quota|daily|monthly/i.test(text);
  } catch {
    return false;
  }
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
        if (res.ok) {
          await res.body?.cancel();
          return;
        }
        const bodyText = await res.text().catch(() => '');
        if (res.status === 429 && isQuotaExhausted(bodyText)) {
          throw new Error('Resend responded 429 (sending quota used up)');
        }
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
