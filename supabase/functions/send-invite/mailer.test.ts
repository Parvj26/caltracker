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
    totalCapMs: 100,
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
    apiKey: 'k', from: 'f@x.com', fetchFn, sleep: () => Promise.resolve(), attemptTimeoutMs: 20, totalCapMs: 1000,
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
  assertEquals(f.sleeps, [5000, 3000]);
  assertEquals(f.calls(), 2, 'no request is started once the budget is spent');
});

Deno.test('resend: fallback backoff is clamped to the remaining budget too', async () => {
  // 600 ms call, 500 ms wait, 600 ms call, then only 300 ms of the 2 s budget is left for the 1 s wait.
  const f = fakeClockMailer({ callMs: 600, status: 429, totalCapMs: 2000 });
  await assertRejects(() => f.mailer.send(msg), Error);
  assertEquals(f.elapsed() <= 2000, true, `ran ${f.elapsed()} ms`);
  assertEquals(f.sleeps, [500, 300]);
});

Deno.test('resend: timeout retries are clamped to the remaining budget', async () => {
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
  assertEquals(sleeps, [200]);
});
