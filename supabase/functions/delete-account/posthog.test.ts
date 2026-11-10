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
      return Promise.resolve(Response.json({ results: [{ uuid: 'person-1' }] }));
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
