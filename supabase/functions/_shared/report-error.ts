import { buildServerErrorEvent } from './caltracker/analytics/server-error.ts';

/**
 * Reports Edge Function failures to PostHog as `$exception` (code `server_error`, `where: fn:<name>`), without
 * delaying the response: the send is handed to `EdgeRuntime.waitUntil` when there is one.
 * Privacy: only builder fields leave (no message, stack, request body or headers). The user id comes from the
 * bearer JWT's `sub`, decoded but NOT verified: attribution only, it grants nothing. No key = no-op.
 */

type Env = { get(key: string): string | undefined };
type Deps = {
  env?: Env;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  waitUntil?: ((p: Promise<unknown>) => void) | undefined;
  /** Statuses that are expected answers, not failures (e.g. send-push's 503 "not configured"). */
  ignoreStatus?: number[];
  /** Never attach the caller's user id (delete-account: no PostHog person may be recreated after erasure). */
  anonymous?: boolean;
};

const DEFAULT_HOST = 'https://us.i.posthog.com';

function runtimeWaitUntil(): ((p: Promise<unknown>) => void) | undefined {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  return typeof runtime?.waitUntil === 'function' ? (p) => runtime.waitUntil!(p) : undefined;
}

function base64UrlDecode(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)),
  );
}

function userIdFromAuth(header: string | null): string | null {
  try {
    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;
    const sub: unknown = (JSON.parse(base64UrlDecode(match[1].split('.')[1] ?? '')) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

async function send(body: unknown, key: string, host: string, fetchImpl: NonNullable<Deps['fetch']>): Promise<void> {
  try {
    await fetchImpl(`${host.replace(/\/+$/, '')}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Best effort: reporting never affects the response.
  }
}

function report(req: Request, where: string, error: unknown, hasError: boolean, deps: Deps): void {
  try {
    const env = deps.env ?? Deno.env;
    const key = env.get('POSTHOG_SERVER_KEY');
    if (!key) return;
    const event = buildServerErrorEvent({
      ...(hasError ? { error } : {}),
      code: 'server_error',
      where,
      distinctId: deps.anonymous ? null : userIdFromAuth(req.headers.get('authorization')),
      sessionId: req.headers.get('x-posthog-session-id'),
    });
    const fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
    const pending = send({ api_key: key, ...event }, key, env.get('POSTHOG_HOST') || DEFAULT_HOST, fetchImpl);
    const waitUntil = 'waitUntil' in deps ? deps.waitUntil : runtimeWaitUntil();
    if (waitUntil) waitUntil(pending);
    else pending.catch(() => {});
  } catch {
    // Best effort.
  }
}

/**
 * Wraps a `Deno.serve` handler. A thrown error is reported and answered with the same plain 500 Deno.serve gives
 * today; a response with status >= 500 (outside `ignoreStatus`) is reported and returned unchanged.
 */
export function withErrorReporting(
  where: string,
  handler: (req: Request) => Promise<Response>,
  deps: Deps = {},
): (req: Request) => Promise<Response> {
  return async (req) => {
    let res: Response;
    try {
      res = await handler(req);
    } catch (error) {
      console.error(error);
      report(req, where, error, true, deps);
      return new Response('Internal Server Error', { status: 500 });
    }
    if (res.status >= 500 && !deps.ignoreStatus?.includes(res.status)) report(req, where, undefined, false, deps);
    return res;
  };
}
