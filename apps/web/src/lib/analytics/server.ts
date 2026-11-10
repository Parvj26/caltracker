import { buildServerErrorEvent, type ServerErrorEvent } from '@caltracker/shared';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Server-side error reporting to PostHog (server actions, request errors). Plain `fetch` to PostHog's capture API
 * and Next's `after()`: nothing host-specific, so it works on Cloudflare (OpenNext) and Vercel alike.
 * Privacy: the event comes only from `buildServerErrorEvent` (fixed fields; never the error's message or stack).
 * No `POSTHOG_SERVER_KEY` = no-op. Nothing here ever throws or delays the user's response.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';
const SESSION_HEADER = 'x-posthog-session-id';

export type SendOptions = { key?: string | undefined; host?: string | undefined; fetchImpl?: typeof fetch };

/** Posts one event to PostHog. Resolves (never rejects) on no key, a bad host, an HTTP error or a timeout. */
export async function send(event: ServerErrorEvent, opts: SendOptions = {}): Promise<void> {
  try {
    const key = opts.key ?? process.env.POSTHOG_SERVER_KEY;
    if (!key) return;
    const host = (opts.host || process.env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/+$/, '');
    const fetchImpl = opts.fetchImpl ?? fetch;
    await fetchImpl(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, ...event }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Reporting is best effort: a failed send must never surface to the user.
  }
}

async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function currentSessionId(): Promise<string | null> {
  try {
    return (await headers()).get(SESSION_HEADER);
  } catch {
    return null;
  }
}

/**
 * Reports a server failure after the response is sent (`after()`), with the signed-in user's id and the browser's
 * PostHog session id when there is one. For server actions and route handlers. Never throws.
 */
export function reportServerError(input: { error?: unknown; code: string; where: string }): void {
  try {
    if (!process.env.POSTHOG_SERVER_KEY) return;
    after(async () => {
      try {
        const [distinctId, sessionId] = await Promise.all([currentUserId(), currentSessionId()]);
        await send(buildServerErrorEvent({ ...input, distinctId, sessionId }));
      } catch {
        // Best effort.
      }
    });
  } catch {
    // after() outside a request scope throws: reporting is skipped.
  }
}

type RequestHeaders = Record<string, string | string[] | undefined>;

function header(headersIn: RequestHeaders, name: string): string | null {
  const value = headersIn[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? null) : null;
}

function base64UrlDecode(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
}

/**
 * The user id (`sub`) from the Supabase auth cookie, decoded but NOT verified: attribution only, never used to
 * grant anything. Handles chunked (`.0`, `.1` …) and `base64-` cookies. Anything unreadable = null.
 */
export function userIdFromCookieHeader(cookieHeader: string | null): string | null {
  try {
    if (!cookieHeader) return null;
    const parts = new Map<string, string>();
    for (const pair of cookieHeader.split(';')) {
      const at = pair.indexOf('=');
      if (at < 0) continue;
      parts.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const base = [...parts.keys()].map((n) => n.replace(/\.\d+$/, '')).find((n) => /^sb-[^.]+-auth-token$/.test(n));
    if (!base) return null;
    let raw = parts.get(base);
    if (raw === undefined) {
      const chunks: string[] = [];
      for (let i = 0; parts.has(`${base}.${i}`); i++) chunks.push(parts.get(`${base}.${i}`)!);
      raw = chunks.join('');
    }
    raw = decodeURIComponent(raw);
    const json = raw.startsWith('base64-') ? base64UrlDecode(raw.slice('base64-'.length)) : raw;
    const token: unknown = (JSON.parse(json) as { access_token?: unknown }).access_token;
    if (typeof token !== 'string') return null;
    const sub: unknown = (JSON.parse(base64UrlDecode(token.split('.')[1] ?? '')) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** `/(coach)/clients/[clientId]/page` → `clients/[clientId]` (route pattern, never real ids or query text). */
export function scrubRoutePath(routePath: string): string {
  const cleaned = routePath
    .split('?')[0]!
    .split('/')
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
    .join('/')
    .replace(/\/?page$/, '')
    .replace(/[^A-Za-z0-9_./[\]-]/g, '_')
    .slice(0, 80);
  return cleaned === '' ? '/' : cleaned;
}

/**
 * Next's `onRequestError` for a thrown server action error. Sends directly (awaited by Next after the error
 * response is under way), with the user id from the auth cookie and the session id header. Never throws.
 */
export async function reportRequestError(
  error: unknown,
  request: { headers: RequestHeaders },
  context: { routeType: string; routePath: string },
  opts: SendOptions = {},
): Promise<void> {
  try {
    if (context.routeType !== 'action') return;
    await send(
      buildServerErrorEvent({
        error,
        code: 'server_error',
        where: `action:${scrubRoutePath(context.routePath)}`,
        distinctId: userIdFromCookieHeader(header(request.headers, 'cookie')),
        sessionId: header(request.headers, SESSION_HEADER),
      }),
      opts,
    );
  } catch {
    // Best effort.
  }
}
