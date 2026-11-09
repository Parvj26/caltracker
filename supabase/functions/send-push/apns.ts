import { signApnsJwt } from './jwt.ts';

export type ApnsConfig = { keyP8: string; keyId: string; teamId: string; topic: string; env: 'sandbox' | 'production' };
export type ApnsPayload = { title: string; body: string; badge: number; route: string; type: string; collapseId: string };
export type ApnsResult =
  | { kind: 'ok' }
  | { kind: 'invalid_token'; reason: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'fail'; reason: string };

/** The cached provider token, with the id of the key that signed it (a rotated key makes it unusable). */
export interface JwtStore {
  get(): Promise<{ jwt: string; issuedAt: Date; keyId: string } | null>;
  put(jwt: string, issuedAt: Date, keyId: string): Promise<void>;
}

/** Apple rejects tokens older than 60 min and throttles refreshes more often than every 20 min. */
export const JWT_MAX_AGE_MS = 50 * 60 * 1000;

/** One APNs request gives up after this long (then retried later), so a stuck connection never stalls a run. */
export const APNS_TIMEOUT_MS = 10_000;

export function apnsConfigFromEnv(get: (k: string) => string | undefined): ApnsConfig | null {
  const keyP8 = get('APNS_KEY_P8');
  const keyId = get('APNS_KEY_ID');
  const teamId = get('APNS_TEAM_ID');
  const topic = get('APNS_TOPIC');
  const env = get('APNS_ENV');
  if (!keyP8 || !keyId || !teamId || !topic) return null;
  if (env !== 'sandbox' && env !== 'production') return null;
  return { keyP8, keyId, teamId, topic, env };
}

const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);
/** Apple refused our provider token: re-sign and try once more; if it is refused again, retry later. */
const PROVIDER_TOKEN_REASONS = new Set(['ExpiredProviderToken', 'InvalidProviderToken']);

export function createApnsClient(
  deps: { cfg: ApnsConfig; store: JwtStore; fetch: typeof fetch; now: () => Date; timeoutMs?: number },
): { send(token: string, p: ApnsPayload): Promise<ApnsResult> } {
  const { cfg, store } = deps;
  const host = cfg.env === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

  async function sign(): Promise<string> {
    const issuedAt = deps.now();
    const jwt = await signApnsJwt(cfg, Math.floor(issuedAt.getTime() / 1000));
    await store.put(jwt, issuedAt, cfg.keyId);
    return jwt;
  }

  async function load(): Promise<string> {
    const stored = await store.get();
    if (stored && stored.keyId === cfg.keyId && deps.now().getTime() - stored.issuedAt.getTime() < JWT_MAX_AGE_MS) {
      return stored.jwt;
    }
    return sign();
  }

  // One token per client (one client per run): read or signed once, shared by every device.
  let jwtPromise: Promise<string> | null = null;
  const currentJwt = () => (jwtPromise ??= load());

  // Apple refused a token: sign a new one, once per refused token, however many sends saw the refusal.
  const resigned = new Map<string, Promise<string>>();
  function resign(refused: string): Promise<string> {
    let next = resigned.get(refused);
    if (!next) {
      next = sign();
      resigned.set(refused, next);
      jwtPromise = next;
    }
    return next;
  }

  async function post(token: string, p: ApnsPayload, jwt: string): Promise<{ status: number; reason: string } | Error> {
    try {
      const res = await deps.fetch(`https://${host}/3/device/${token}`, {
        method: 'POST',
        signal: AbortSignal.timeout(deps.timeoutMs ?? APNS_TIMEOUT_MS),
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': cfg.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': p.collapseId,
        },
        body: JSON.stringify({
          aps: { alert: { title: p.title, body: p.body }, badge: p.badge, sound: 'default', 'thread-id': p.type },
          route: p.route,
          type: p.type,
        }),
      });
      let reason = '';
      if (res.status !== 200) {
        try {
          reason = ((await res.json()) as { reason?: string }).reason ?? '';
        } catch { /* body is optional */ }
      }
      return { status: res.status, reason };
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }

  function map(r: { status: number; reason: string } | Error): ApnsResult {
    if (r instanceof Error) return { kind: 'retry', reason: `fetch failed: ${r.message}` };
    const reason = r.reason || `HTTP ${r.status}`;
    if (r.status === 200) return { kind: 'ok' };
    if (r.status === 410 || INVALID_TOKEN_REASONS.has(r.reason)) return { kind: 'invalid_token', reason };
    if (r.status === 429 || r.status >= 500 || PROVIDER_TOKEN_REASONS.has(r.reason)) return { kind: 'retry', reason };
    return { kind: 'fail', reason };
  }

  return {
    async send(token, p) {
      const jwt = await currentJwt();
      let r = await post(token, p, jwt);
      if (!(r instanceof Error) && r.status === 403 && PROVIDER_TOKEN_REASONS.has(r.reason)) {
        r = await post(token, p, await resign(jwt));
      }
      return map(r);
    },
  };
}
