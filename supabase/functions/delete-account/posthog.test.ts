import { assertEquals, assertRejects } from '@std/assert';
import { createPosthogEraser } from './posthog.ts';

const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

Deno.test('posthog: no key configured means no eraser (skipped)', () => {
  assertEquals(createPosthogEraser(env({})), null);
  assertEquals(createPosthogEraser(env({ POSTHOG_PERSONAL_API_KEY: 'k' })), null, 'the project id is needed too');
});

Deno.test('posthog: finds the person by distinct id and deletes them with their events', async () => {
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization') });
    if (url.includes('distinct_id=')) {
      return Promise.resolve(Response.json({ results: [{ uuid: 'person-1', distinct_ids: ['anon-1', 'user-1'] }] }));
    }
    return Promise.resolve(new Response(null, { status: 202 }));
  };
  const eraser = createPosthogEraser(
    env({ POSTHOG_PERSONAL_API_KEY: 'phx_test', POSTHOG_PROJECT_ID: '42', POSTHOG_API_HOST: 'https://ph.example/' }),
    fetchFn,
  )!;
  assertEquals(await eraser.erase('user-1'), 'deleted');
  assertEquals(calls, [
    { method: 'GET', url: 'https://ph.example/api/projects/42/persons/?distinct_id=user-1', auth: 'Bearer phx_test' },
    { method: 'DELETE', url: 'https://ph.example/api/projects/42/persons/person-1/?delete_events=true', auth: 'Bearer phx_test' },
  ]);
});

Deno.test('posthog: a person PostHog never saw is fine', async () => {
  const fetchFn: typeof fetch = () => Promise.resolve(Response.json({ results: [] }));
  const eraser = createPosthogEraser(env({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: '1' }), fetchFn)!;
  assertEquals(await eraser.erase('user-1'), 'not_found');
});

Deno.test('posthog: an error status throws', async () => {
  const fetchFn: typeof fetch = () => Promise.resolve(new Response('nope', { status: 401 }));
  const eraser = createPosthogEraser(env({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: '1' }), fetchFn)!;
  await assertRejects(() => eraser.erase('user-1'), Error, '401');
});

/** Records DELETE calls; the lookup answers with `results` whatever the query (as if PostHog ignored the filter). */
function lookupReturning(results: unknown[]) {
  const deleted: string[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    if ((init?.method ?? 'GET') === 'DELETE') {
      deleted.push(String(input));
      return Promise.resolve(new Response(null, { status: 202 }));
    }
    return Promise.resolve(Response.json({ results }));
  };
  const eraser = createPosthogEraser(env({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: '1' }), fetchFn)!;
  return { eraser, deleted };
}

Deno.test('posthog: an unfiltered answer with other people deletes only the person with that distinct id', async () => {
  const { eraser, deleted } = lookupReturning([
    { uuid: 'someone-else', distinct_ids: ['user-2'] },
    { uuid: 'no-ids' },
    { uuid: 'target', distinct_ids: ['user-1'] },
    { uuid: 'another', distinct_ids: ['user-10', 'xuser-1'] },
  ]);
  assertEquals(await eraser.erase('user-1'), 'deleted');
  assertEquals(deleted, ['https://us.posthog.com/api/projects/1/persons/target/?delete_events=true']);
});

Deno.test('posthog: other people only (no match) deletes nothing', async () => {
  const { eraser, deleted } = lookupReturning([{ uuid: 'someone-else', distinct_ids: ['user-2'] }]);
  assertEquals(await eraser.erase('user-1'), 'not_found');
  assertEquals(deleted, []);
});

Deno.test('posthog: two people with that distinct id is ambiguous, so nothing is deleted', async () => {
  const { eraser, deleted } = lookupReturning([
    { uuid: 'a', distinct_ids: ['user-1'] },
    { uuid: 'b', distinct_ids: ['user-1', 'anon'] },
  ]);
  assertEquals(await eraser.erase('user-1'), 'ambiguous');
  assertEquals(deleted, []);
});
