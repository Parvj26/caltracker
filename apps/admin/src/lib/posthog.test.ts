import { describe, expect, it, vi } from 'vitest';
import { fetchPosthogTimeline } from './posthog';

const env = { POSTHOG_PERSONAL_KEY: 'phx_test', POSTHOG_PROJECT_ID: '123' };

function okResponse(results: unknown[][]): Response {
  return new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('fetchPosthogTimeline', () => {
  it('maps tracked events to plain labels and drops noise', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      okResponse([
        ['app_opened', '2026-11-09T07:02:00Z', JSON.stringify({ $app_version: '1.0.0', $app_build: '2' })],
        ['rage_tap', '2026-11-09T07:03:00Z', '{}'],
        ['task_completed', '2026-11-09T07:05:00Z', { task: 'log_meal' }],
        ['$pageview', '2026-11-09T07:06:00Z', '{}'],
      ]),
    );
    const events = await fetchPosthogTimeline('user-1', { env, fetch: fetchFn });
    expect(events).toEqual([
      { at: '2026-11-09T07:02:00Z', source: 'app', label: 'Opened the app (1.0.0 build 2)' },
      { at: '2026-11-09T07:05:00Z', source: 'app', label: 'Logged a meal' },
    ]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://us.posthog.com/api/projects/123/query/');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer phx_test');
    const body = JSON.parse(init?.body as string) as { query: { kind: string; query: string; values: Record<string, string> } };
    expect(body.query.kind).toBe('HogQLQuery');
    // The person's id goes in as a value, never pasted into the query text.
    expect(body.query.values).toEqual({ distinct_id: 'user-1' });
    expect(body.query.query).not.toContain('user-1');
    expect(body.query.query).toContain('30 day');
  });

  it('returns an Error on 401', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"detail":"bad key"}', { status: 401 }));
    const result = await fetchPosthogTimeline('user-1', { env, fetch: fetchFn });
    expect(result).toBeInstanceOf(Error);
  });

  it('returns an Error, without calling PostHog, when the key is missing', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(await fetchPosthogTimeline('user-1', { env: { POSTHOG_PROJECT_ID: '123' }, fetch: fetchFn })).toBeInstanceOf(Error);
    expect(await fetchPosthogTimeline('user-1', { env: { POSTHOG_PERSONAL_KEY: 'k' }, fetch: fetchFn })).toBeInstanceOf(Error);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns an Error when the network fails or the answer is malformed', async () => {
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await fetchPosthogTimeline('user-1', { env, fetch: down })).toBeInstanceOf(Error);
    const odd = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"nope":1}', { status: 200 }));
    expect(await fetchPosthogTimeline('user-1', { env, fetch: odd })).toBeInstanceOf(Error);
  });
});
