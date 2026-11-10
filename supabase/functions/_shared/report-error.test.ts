import { assert, assertEquals } from '@std/assert';
import { withErrorReporting } from './report-error.ts';

const USER = '0b6a8f7e-3c2d-4e1f-9a8b-7c6d5e4f3a2b';
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: unknown) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;

/** Captures fetch calls and the promises handed to waitUntil. */
function harness(opts: { key?: string; fetchFails?: boolean } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const pending: Promise<unknown>[] = [];
  const deps = {
    env: { get: (k: string) => (k === 'POSTHOG_SERVER_KEY' ? opts.key : undefined) },
    fetch: (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(init?.body as string) as Record<string, unknown> });
      return opts.fetchFails ? Promise.reject(new Error('down')) : Promise.resolve(new Response('{}'));
    },
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
  };
  return { calls, deps, settle: () => Promise.all(pending) };
}

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/send-invite', { method: 'POST', headers, body: '{"email":"luis@example.com"}' });

Deno.test('withErrorReporting: a throwing handler answers 500 and reports once, without the message', async () => {
  const { calls, deps, settle } = harness({ key: 'phc_x' });
  const handler = withErrorReporting(
    'fn:send-invite',
    () => Promise.reject(new TypeError('luis@example.com not found')),
    deps,
  );
  const res = await handler(
    request({ Authorization: `Bearer ${jwt({ sub: USER, email: 'luis@example.com' })}`, 'x-posthog-session-id': 'sess-1' }),
  );
  assertEquals(res.status, 500);
  assertEquals(await res.text(), 'Internal Server Error');
  await settle();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://us.i.posthog.com/i/v0/e/');
  assertEquals(calls[0].body, {
    api_key: 'phc_x',
    event: '$exception',
    distinct_id: USER,
    properties: {
      $exception_list: [{ type: 'TypeError', value: 'server_error' }],
      code: 'server_error',
      where: 'fn:send-invite',
      $session_id: 'sess-1',
    },
  });
  assert(!JSON.stringify(calls).includes('luis'));
});

Deno.test('withErrorReporting: a 5xx response is reported and passed through unchanged', async () => {
  const { calls, deps, settle } = harness({ key: 'phc_x' });
  const handler = withErrorReporting(
    'fn:send-push',
    () => Promise.resolve(Response.json({ error: 'Something went wrong.' }, { status: 500 })),
    deps,
  );
  const res = await handler(request());
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'Something went wrong.' });
  await settle();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body.distinct_id, 'server');
  assertEquals((calls[0].body.properties as Record<string, unknown>).where, 'fn:send-push');
  assertEquals((calls[0].body.properties as Record<string, unknown>).$exception_list, [
    { type: 'ActionFailed', value: 'server_error' },
  ]);
});

Deno.test('withErrorReporting: a 200 or 4xx response sends nothing', async () => {
  const { calls, deps, settle } = harness({ key: 'phc_x' });
  for (const status of [200, 400, 401, 404]) {
    const res = await withErrorReporting('fn:a', () => Promise.resolve(new Response('ok', { status })), deps)(request());
    assertEquals(res.status, status);
  }
  await settle();
  assertEquals(calls.length, 0);
});

Deno.test('withErrorReporting: no key means no fetch', async () => {
  const { calls, deps, settle } = harness();
  const res = await withErrorReporting('fn:a', () => Promise.reject(new Error('x')), deps)(request());
  assertEquals(res.status, 500);
  await settle();
  assertEquals(calls.length, 0);
});

Deno.test('withErrorReporting: a failing send leaves the response unaffected', async () => {
  const { calls, deps, settle } = harness({ key: 'phc_x', fetchFails: true });
  const res = await withErrorReporting('fn:a', () => Promise.reject(new Error('x')), deps)(request());
  assertEquals(res.status, 500);
  await settle();
  assertEquals(calls.length, 1);

  const ok = await withErrorReporting(
    'fn:a',
    () => Promise.resolve(Response.json({ ok: true }, { status: 503 })),
    { ...deps, fetch: () => { throw new Error('sync throw'); } },
  )(request());
  assertEquals(ok.status, 503);
});

Deno.test('withErrorReporting: a garbage bearer token falls back to server', async () => {
  const { calls, deps, settle } = harness({ key: 'phc_x' });
  for (const auth of ['Bearer not.a.jwt', 'Bearer x', `Bearer ${jwt({ sub: 'luis@example.com' })}`, 'Basic abc']) {
    await withErrorReporting('fn:a', () => Promise.reject(new Error('x')), deps)(request({ Authorization: auth }));
  }
  await settle();
  assertEquals(calls.map((c) => c.body.distinct_id), ['server', 'server', 'server', 'server']);
  assert(!JSON.stringify(calls).includes('luis'));
});

Deno.test('withErrorReporting: without waitUntil the send still runs in the background', async () => {
  const { calls, deps } = harness({ key: 'phc_x', fetchFails: true });
  const res = await withErrorReporting('fn:a', () => Promise.reject(new Error('x')), { ...deps, waitUntil: undefined })(
    request(),
  );
  assertEquals(res.status, 500);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(calls.length, 1);
});
