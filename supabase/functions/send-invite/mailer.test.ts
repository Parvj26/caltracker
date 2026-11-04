import { assertEquals, assertRejects } from '@std/assert';
import { createResendMailer } from './mailer.ts';

const msg = { to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 'h' };

function stub(statuses: number[], headers: Record<string, string> = {}) {
  let calls = 0;
  const fetchFn = ((_url: string | URL | Request, _init?: RequestInit) => {
    const status = statuses[Math.min(calls++, statuses.length - 1)]!;
    return Promise.resolve(
      new Response(status === 200 ? '{"id":"x"}' : 'nope', {
        status,
        headers: status === 429 ? headers : {},
      }),
    );
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

function mailerWith(statuses: number[], headers: Record<string, string> = {}) {
  const s = stub(statuses, headers);
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
