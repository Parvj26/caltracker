import { assert, assertEquals } from '@std/assert';
import { APNS_TIMEOUT_MS, type ApnsConfig, type ApnsPayload, apnsConfigFromEnv, createApnsClient, type JwtStore } from './apns.ts';

async function throwawayKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join('\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const TOKEN = 'abc123def456';
const payload: ApnsPayload = {
  title: 'Message from Luis',
  body: 'Luis sent you a message.',
  badge: 2,
  route: '/coach',
  type: 'message',
  collapseId: 'msg-1',
};
const { pem } = await throwawayKey();
const baseCfg: ApnsConfig = { keyP8: pem, keyId: 'KEY123', teamId: '88L5M6CC34', topic: 'app.caltracker.client', env: 'sandbox' };
const T0 = new Date('2026-11-09T10:00:00Z');

type Call = [string, RequestInit & { headers: Record<string, string>; body: string }];
function setup(responses: Array<Response | Error>, opts: { env?: 'sandbox' | 'production'; stored?: { jwt: string; issuedAt: Date } | null; now?: () => Date } = {}) {
  const calls: Call[] = [];
  const puts: Array<[string, Date]> = [];
  let stored = opts.stored ?? null;
  const store: JwtStore = {
    get: () => Promise.resolve(stored),
    put: (jwt, at) => {
      puts.push([jwt, at]);
      stored = { jwt, issuedAt: at };
      return Promise.resolve();
    },
  };
  let i = 0;
  const fetchMock = ((url: string, init: Call[1]) => {
    calls.push([url, init]);
    const r = responses[Math.min(i++, responses.length - 1)];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r.clone());
  }) as unknown as typeof fetch;
  const client = createApnsClient({ cfg: { ...baseCfg, env: opts.env ?? 'sandbox' }, store, fetch: fetchMock, now: opts.now ?? (() => T0) });
  return { client, calls, puts };
}
const ok = () => new Response(null, { status: 200 });
const err = (status: number, reason: string) => new Response(JSON.stringify({ reason }), { status });

Deno.test('request shape', async () => {
  const jwt = 'stored.jwt.value';
  const { client, calls } = setup([ok()], { env: 'production', stored: { jwt, issuedAt: T0 } });
  await client.send(TOKEN, payload);
  const [url, init] = calls[0];
  assertEquals(url, `https://api.push.apple.com/3/device/${TOKEN}`);
  assertEquals(init.method, 'POST');
  assertEquals(init.headers, {
    authorization: `bearer ${jwt}`,
    'apns-topic': 'app.caltracker.client',
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-collapse-id': payload.collapseId,
  });
  assertEquals(JSON.parse(init.body), {
    aps: { alert: { title: 'Message from Luis', body: 'Luis sent you a message.' }, badge: 2, sound: 'default', 'thread-id': 'message' },
    route: '/coach',
    type: 'message',
  });
});

Deno.test('sandbox host', async () => {
  const { client, calls } = setup([ok()]);
  await client.send(TOKEN, payload);
  assertEquals(calls[0][0], `https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
});

Deno.test('signs and stores a JWT when none is stored', async () => {
  const { client, calls, puts } = setup([ok()]);
  await client.send(TOKEN, payload);
  assertEquals(puts.length, 1);
  assertEquals(puts[0][1], T0);
  assertEquals(calls[0][1].headers.authorization, `bearer ${puts[0][0]}`);
});

Deno.test('reuses a JWT younger than 50 minutes', async () => {
  const issuedAt = new Date(T0.getTime() - 49 * 60_000);
  const { client, calls, puts } = setup([ok()], { stored: { jwt: 'old.jwt.x', issuedAt } });
  await client.send(TOKEN, payload);
  assertEquals(puts.length, 0);
  assertEquals(calls[0][1].headers.authorization, 'bearer old.jwt.x');
});

Deno.test('signs a new one at 50 minutes and stores it', async () => {
  const issuedAt = new Date(T0.getTime() - 50 * 60_000);
  const { client, calls, puts } = setup([ok()], { stored: { jwt: 'old.jwt.x', issuedAt } });
  await client.send(TOKEN, payload);
  assertEquals(puts.length, 1);
  assert(calls[0][1].headers.authorization !== 'bearer old.jwt.x');
});

Deno.test('ExpiredProviderToken: re-signs once and retries', async () => {
  const { client, calls, puts } = setup([err(403, 'ExpiredProviderToken'), ok()], { stored: { jwt: 'old.jwt.x', issuedAt: T0 } });
  assertEquals(await client.send(TOKEN, payload), { kind: 'ok' });
  assertEquals(calls.length, 2);
  assertEquals(puts.length, 1);
  assert(calls[1][1].headers.authorization !== 'bearer old.jwt.x');
});

Deno.test('ExpiredProviderToken twice: does not loop', async () => {
  const { client, calls } = setup([err(403, 'ExpiredProviderToken')]);
  const r = await client.send(TOKEN, payload);
  assertEquals(calls.length, 2);
  assertEquals(r.kind, 'retry');
});

const mappings: Array<[string, Response | Error, string]> = [
  ['200', ok(), 'ok'],
  ['410 Unregistered', err(410, 'Unregistered'), 'invalid_token'],
  ['400 BadDeviceToken', err(400, 'BadDeviceToken'), 'invalid_token'],
  ['400 DeviceTokenNotForTopic', err(400, 'DeviceTokenNotForTopic'), 'invalid_token'],
  ['429 TooManyRequests', err(429, 'TooManyRequests'), 'retry'],
  ['500', err(500, 'InternalServerError'), 'retry'],
  ['503', err(503, 'ServiceUnavailable'), 'retry'],
  ['fetch throws', new Error('network down'), 'retry'],
  ['400 PayloadTooLarge', err(400, 'PayloadTooLarge'), 'fail'],
];
for (const [name, res, kind] of mappings) {
  Deno.test(`maps ${name} to ${kind}`, async () => {
    const { client } = setup([res], { stored: { jwt: 'j.w.t', issuedAt: T0 } });
    const r = await client.send(TOKEN, payload);
    assertEquals(r.kind, kind);
    if (r.kind === 'invalid_token') assert(r.reason.length > 0);
  });
}

Deno.test('each request gives up after a timeout (10 s by default) and is retried later', async () => {
  assertEquals(APNS_TIMEOUT_MS, 10_000);
  let signal: AbortSignal | null | undefined;
  const hanging = ((_url: string, init: RequestInit) => {
    signal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
    });
  }) as unknown as typeof fetch;
  const store: JwtStore = { get: () => Promise.resolve({ jwt: 'j.w.t', issuedAt: T0 }), put: () => Promise.resolve() };
  const client = createApnsClient({ cfg: baseCfg, store, fetch: hanging, now: () => T0, timeoutMs: 20 });
  const r = await client.send(TOKEN, payload);
  assert(signal instanceof AbortSignal, 'the request carries an abort signal');
  assertEquals(r.kind, 'retry');
});

Deno.test('apnsConfigFromEnv: null when a secret is missing or APNS_ENV is wrong', () => {
  const full: Record<string, string> = {
    APNS_KEY_P8: 'k', APNS_KEY_ID: 'id', APNS_TEAM_ID: 't', APNS_TOPIC: 'app.caltracker.client', APNS_ENV: 'production',
  };
  assertEquals(apnsConfigFromEnv((k) => full[k]), { keyP8: 'k', keyId: 'id', teamId: 't', topic: 'app.caltracker.client', env: 'production' });
  for (const k of Object.keys(full)) assertEquals(apnsConfigFromEnv((n) => (n === k ? undefined : full[n])), null);
  assertEquals(apnsConfigFromEnv((n) => (n === 'APNS_ENV' ? 'staging' : full[n])), null);
});
