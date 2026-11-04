import { assertEquals, assertRejects } from '@std/assert';
import { createResendMailer } from './mailer.ts';

const msg = { to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 'h' };

function stub(statuses: number[], headers: Record<string, string> = {}, body429 = 'nope') {
  let calls = 0;
  const fetchFn = ((_url: string | URL | Request, _init?: RequestInit) => {
    const status = statuses[Math.min(calls++, statuses.length - 1)]!;
    return Promise.resolve(
      new Response(status === 200 ? '{"id":"x"}' : status === 429 ? body429 : 'nope', {
        status,
        headers: status === 429 ? headers : {},
      }),
    );
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

function mailerWith(statuses: number[], headers: Record<string, string> = {}, body429 = 'nope') {
  const s = stub(statuses, headers, body429);
  const sleeps: number[] = [];
  const mailer = createResendMailer({
    apiKey: 'k',
    from: 'f@x.com',
    fetchFn: s.fetchFn,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { mailer, sleeps, calls: s.calls };
}

Deno.test('resend: 429 then 200 succeeds, using the fallback backoff', async () => {
  const { mailer, sleeps, calls } = mailerWith([429, 200]);
  await mailer.send(msg);
  assertEquals(calls(), 2);
  assertEquals(sleeps, [500]);
});

Deno.test('resend: honours the retry-after header (seconds)', async () => {
  const { mailer, sleeps } = mailerWith([429, 429, 200], { 'retry-after': '2' });
  await mailer.send(msg);
  assertEquals(sleeps, [2000, 2000]);
});

Deno.test('resend: 429 four times fails after 3 retries with 500ms/1s/2s backoff', async () => {
  const { mailer, sleeps, calls } = mailerWith([429, 429, 429, 429]);
  await assertRejects(() => mailer.send(msg), Error, 'Resend responded 429');
  assertEquals(calls(), 4);
  assertEquals(sleeps, [500, 1000, 2000]);
});

Deno.test('resend: other errors are not retried', async () => {
  const { mailer, calls } = mailerWith([500]);
  await assertRejects(() => mailer.send(msg), Error, 'Resend responded 500');
  assertEquals(calls(), 1);
});

Deno.test('resend: retry-after is capped at 5 seconds', async () => {
  const { mailer, sleeps } = mailerWith([429, 200], { 'retry-after': '600' });
  await mailer.send(msg);
  assertEquals(sleeps, [5000]);
});

Deno.test('resend: a daily quota 429 fails immediately without retrying', async () => {
  const body = JSON.stringify({ name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' });
  const { mailer, sleeps, calls } = mailerWith([429, 200], {}, body);
  await assertRejects(() => mailer.send(msg), Error, '429');
  assertEquals(calls(), 1);
  assertEquals(sleeps, []);
});

Deno.test('resend: a monthly quota 429 (message only) fails immediately', async () => {
  const body = JSON.stringify({ name: 'rate_limit_exceeded', message: 'Monthly limit reached' });
  const { mailer, calls } = mailerWith([429, 200], {}, body);
  await assertRejects(() => mailer.send(msg), Error, '429');
  assertEquals(calls(), 1);
});

Deno.test('resend: a plain rate-limit 429 JSON is still retried', async () => {
  const body = JSON.stringify({ name: 'rate_limit_exceeded', message: 'Too many requests. You can only make 2 requests per second.' });
  const { mailer, calls } = mailerWith([429, 200], {}, body);
  await mailer.send(msg);
  assertEquals(calls(), 2);
});

// A fetch that never answers until its abort signal fires, like a hung connection.
function hangingFetch() {
  let calls = 0;
  const fetchFn = ((_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

Deno.test('resend: a request that never answers is aborted and the call fails within the total cap', async () => {
  const h = hangingFetch();
  const mailer = createResendMailer({
    apiKey: 'k',
    from: 'f@x.com',
    fetchFn: h.fetchFn,
    sleep: () => Promise.resolve(),
    attemptTimeoutMs: 20,
    totalCapMs: 2000,
    minAttemptMs: 10,
  });
  const started = Date.now();
  await assertRejects(() => mailer.send(msg), Error, 'did not answer in time');
  assertEquals(h.calls() > 1, true, 'a timeout counts as a failed attempt and is retried');
  assertEquals(h.calls() <= 4, true);
  assertEquals(Date.now() - started < 1000, true);
});

Deno.test('resend: a timeout followed by a good answer still sends', async () => {
  let calls = 0;
  const fetchFn = ((_u: string | URL | Request, init?: RequestInit) => {
    if (calls++ === 0) {
      return new Promise<Response>((_res, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
    return Promise.resolve(new Response('{"id":"x"}', { status: 200 }));
  }) as typeof fetch;
  const mailer = createResendMailer({
    apiKey: 'k', from: 'f@x.com', fetchFn, sleep: () => Promise.resolve(), attemptTimeoutMs: 20, totalCapMs: 1000, minAttemptMs: 10,
  });
  await mailer.send(msg);
  assertEquals(calls, 2);
});

// A fake clock: each Resend call "takes" callMs and every sleep advances the clock by what it was asked.
function fakeClockMailer(opts: { callMs: number; status: number; headers?: Record<string, string>; totalCapMs?: number }) {
  let clock = 0;
  const sleeps: number[] = [];
  let calls = 0;
  const fetchFn = ((_u: string | URL | Request, _init?: RequestInit) => {
    calls++;
    clock += opts.callMs;
    return Promise.resolve(new Response('nope', { status: opts.status, headers: opts.headers ?? {} }));
  }) as typeof fetch;
  const mailer = createResendMailer({
    apiKey: 'k',
    from: 'f@x.com',
    fetchFn,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    totalCapMs: opts.totalCapMs,
  });
  return { mailer, sleeps, calls: () => calls, elapsed: () => clock };
}

Deno.test('resend: retry waits are clamped so one email never runs past the 20 s total cap', async () => {
  // Each call takes 6 s and asks to wait 5 s: unclamped this would run 6+5+6+5+6 = 28 s.
  const f = fakeClockMailer({ callMs: 6000, status: 429, headers: { 'retry-after': '5' } });
  await assertRejects(() => f.mailer.send(msg), Error);
  assertEquals(f.elapsed() <= 20_000, true, `ran ${f.elapsed()} ms`);
  // After 17 s only 3 s are left: a 5 s wait would overrun, so it gives up instead of waiting.
  assertEquals(f.sleeps, [5000]);
  assertEquals(f.calls(), 2, 'no request is started once the budget is spent');
});

Deno.test('resend: fallback backoff stops once a wait would leave too little budget', async () => {
  // 600 ms call, 500 ms wait, 600 ms call, 1 s wait, 600 ms call: 700 ms of the 4 s budget is left, too little.
  const f = fakeClockMailer({ callMs: 600, status: 429, totalCapMs: 4000 });
  await assertRejects(() => f.mailer.send(msg), Error);
  assertEquals(f.elapsed() <= 4000, true, `ran ${f.elapsed()} ms`);
  assertEquals(f.sleeps, [500, 1000]);
  assertEquals(f.calls(), 3);
});

Deno.test('resend: no timeout retry when too little budget is left', async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const fetchFn = ((_u: string | URL | Request, _init?: RequestInit) => {
    clock += 1800; // the attempt ran until (almost) the cap, then timed out
    return Promise.reject(new DOMException('timed out', 'TimeoutError'));
  }) as typeof fetch;
  const mailer = createResendMailer({
    apiKey: 'k', from: 'f@x.com', fetchFn, now: () => clock, totalCapMs: 2000,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  });
  await assertRejects(() => mailer.send(msg), Error, 'did not answer in time');
  assertEquals(clock <= 2000, true, `ran ${clock} ms`);
  assertEquals(sleeps, []);
});

Deno.test('resend: another attempt needs at least 1 s of budget left', async () => {
  // retry-after 0 means no wait: what matters is how much of the 20 s is left after the first call.
  const tooLate = fakeClockMailer({ callMs: 19_001, status: 429, headers: { 'retry-after': '0' } });
  await assertRejects(() => tooLate.mailer.send(msg), Error, '429');
  assertEquals(tooLate.calls(), 1, 'a retry with under 1 s left could send while we report failure');

  const justInTime = fakeClockMailer({ callMs: 19_000, status: 429, headers: { 'retry-after': '0' } });
  await assertRejects(() => justInTime.mailer.send(msg), Error, '429');
  assertEquals(justInTime.calls(), 2);
});

function recordingFetch(statuses: number[]) {
  const keys: (string | null)[] = [];
  let calls = 0;
  const fetchFn = ((_u: string | URL | Request, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get('idempotency-key'));
    const status = statuses[Math.min(calls++, statuses.length - 1)]!;
    return Promise.resolve(new Response(status === 200 ? '{"id":"x"}' : 'nope', { status }));
  }) as typeof fetch;
  return { fetchFn, keys };
}

Deno.test('resend: retries of one email reuse the same Idempotency-Key', async () => {
  const r = recordingFetch([429, 429, 200]);
  const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.com', fetchFn: r.fetchFn, sleep: () => Promise.resolve() });
  await mailer.send(msg);
  assertEquals(r.keys.length, 3);
  assertEquals(typeof r.keys[0] === 'string' && r.keys[0].length > 0, true);
  assertEquals(new Set(r.keys).size, 1);
});

Deno.test('resend: a timed-out attempt and its retry share the Idempotency-Key', async () => {
  const keys: (string | null)[] = [];
  let calls = 0;
  const fetchFn = ((_u: string | URL | Request, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get('idempotency-key'));
    if (calls++ === 0) return Promise.reject(new DOMException('timed out', 'TimeoutError'));
    return Promise.resolve(new Response('{"id":"x"}', { status: 200 }));
  }) as typeof fetch;
  const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.com', fetchFn, sleep: () => Promise.resolve() });
  await mailer.send(msg);
  assertEquals(keys.length, 2);
  assertEquals(keys[0] !== null && keys[0] === keys[1], true);
});

Deno.test('resend: different emails get different Idempotency-Keys', async () => {
  const r = recordingFetch([200]);
  const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.com', fetchFn: r.fetchFn, sleep: () => Promise.resolve() });
  await mailer.send(msg);
  await mailer.send(msg);
  assertEquals(r.keys.length, 2);
  assertEquals(r.keys[0] !== null && r.keys[1] !== null && r.keys[0] !== r.keys[1], true);
});

function sequenceFetch(answers: { status: number; body: string }[]) {
  let calls = 0;
  const fetchFn = ((_u: string | URL | Request, _init?: RequestInit) => {
    const a = answers[Math.min(calls++, answers.length - 1)]!;
    return Promise.resolve(new Response(a.body, { status: a.status }));
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

const concurrent409 = {
  status: 409,
  body: JSON.stringify({ name: 'concurrent_idempotent_requests', message: 'Same idempotency key used while original request is still in progress.' }),
};

Deno.test('resend: a 409 concurrent_idempotent_requests is retried with backoff (first attempt still in flight)', async () => {
  const f = sequenceFetch([concurrent409, concurrent409, { status: 200, body: '{"id":"x"}' }]);
  const sleeps: number[] = [];
  const mailer = createResendMailer({
    apiKey: 'k', from: 'f@x.com', fetchFn: f.fetchFn,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  await mailer.send(msg);
  assertEquals(f.calls(), 3);
  assertEquals(sleeps, [500, 1000]);
});

Deno.test('resend: a 409 concurrent_idempotent_requests fails once retries or the budget run out', async () => {
  let clock = 0;
  let calls = 0;
  const fetchFn = ((_u: string | URL | Request, _init?: RequestInit) => {
    calls++;
    clock += 6000;
    return Promise.resolve(new Response(concurrent409.body, { status: 409 }));
  }) as typeof fetch;
  const mailer = createResendMailer({
    apiKey: 'k', from: 'f@x.com', fetchFn, now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  });
  await assertRejects(() => mailer.send(msg), Error, 'Resend responded 409');
  assertEquals(calls > 1, true);
  assertEquals(clock <= 20_000, true, `ran ${clock} ms`);
});

Deno.test('resend: a 409 invalid_idempotent_request is not retried', async () => {
  const f = sequenceFetch([
    { status: 409, body: JSON.stringify({ name: 'invalid_idempotent_request', message: 'Same idempotency key used with a different request payload.' }) },
    { status: 200, body: '{"id":"x"}' },
  ]);
  const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.com', fetchFn: f.fetchFn, sleep: () => Promise.resolve() });
  await assertRejects(() => mailer.send(msg), Error, 'Resend responded 409');
  assertEquals(f.calls(), 1);
});
