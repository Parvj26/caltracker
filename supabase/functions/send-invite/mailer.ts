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
/** One Resend request that takes longer than this is abandoned and counts as a failed attempt. */
const ATTEMPT_TIMEOUT_MS = 10_000;
/** All attempts, waits included, for one email: a stuck row must not hold up the whole batch. */
const TOTAL_CAP_MS = 20_000;

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
  /** Per-request timeout (default 10 s) and total cap per email (default 20 s); injectable for tests. */
  attemptTimeoutMs?: number;
  totalCapMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}): Mailer {
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const totalCapMs = opts.totalCapMs ?? TOTAL_CAP_MS;
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  return {
    async send(msg) {
      const startedAt = now();
      const remainingMs = () => totalCapMs - (now() - startedAt);
      // Generated once per email and reused on every retry: if Resend accepted a request that then
      // timed out on our side, the retry is recognised as the same email and not sent twice.
      const idempotencyKey = crypto.randomUUID();
      /** Wait before a retry, never past the total cap. False when no time is left to try again. */
      const waitBeforeRetry = async (ms: number): Promise<boolean> => {
        const left = remainingMs();
        if (left <= 0) return false;
        await sleep(Math.min(ms, left));
        return remainingMs() > 0;
      };
      for (let attempt = 0; ; attempt++) {
        const remaining = remainingMs();
        if (remaining <= 0) throw new Error('Resend did not answer in time');
        let res: Response;
        try {
          res = await fetchFn('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${opts.apiKey}`,
              'content-type': 'application/json',
              'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify({ from: opts.from, ...msg }),
            signal: AbortSignal.timeout(Math.min(attemptTimeoutMs, remaining)),
          });
        } catch (err) {
          const timedOut = err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
          if (!timedOut) throw err;
          // A timeout is a failed attempt: retry while attempts and the total cap allow.
          if (attempt < RESEND_MAX_RETRIES && (await waitBeforeRetry(RESEND_BACKOFF_MS[attempt] ?? 2000))) {
            continue;
          }
          throw new Error('Resend did not answer in time');
        }
        if (res.ok) {
          await res.body?.cancel();
          return;
        }
        const bodyText = await res.text().catch(() => '');
        if (res.status === 429 && isQuotaExhausted(bodyText)) {
          throw new Error('Resend responded 429 (sending quota used up)');
        }
        // Resend allows 2 requests per second; back off and retry when it says slow down.
        if (res.status === 429 && attempt < RESEND_MAX_RETRIES && (await waitBeforeRetry(retryDelayMs(res, attempt)))) {
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
