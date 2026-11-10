// Asks PostHog to forget a deleted user: the person and their events. Needs a personal API key with person write
// access (POSTHOG_PERSONAL_API_KEY, a server secret, never the public project key the apps use) and the project id.
// Without them this is skipped. The apps identify people by their Supabase user id, so that is the distinct id.

export interface PosthogEraser {
  erase(distinctId: string): Promise<'deleted' | 'not_found'>;
}

const TIMEOUT_MS = 8000;

export function createPosthogEraser(
  env: { get(key: string): string | undefined },
  fetchFn: typeof fetch = fetch,
): PosthogEraser | null {
  const key = env.get('POSTHOG_PERSONAL_API_KEY');
  const project = env.get('POSTHOG_PROJECT_ID');
  if (!key || !project) return null;
  const host = (env.get('POSTHOG_API_HOST') || 'https://us.posthog.com').replace(/\/+$/, '');
  const base = `${host}/api/projects/${encodeURIComponent(project)}/persons/`;
  const headers = { authorization: `Bearer ${key}` };
  return {
    async erase(distinctId) {
      const found = await fetchFn(`${base}?distinct_id=${encodeURIComponent(distinctId)}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!found.ok) {
        await found.body?.cancel();
        throw new Error(`PostHog person lookup responded ${found.status}`);
      }
      const body = (await found.json()) as { results?: { uuid?: string }[] };
      const people = (body.results ?? []).map((r) => r.uuid).filter((u): u is string => Boolean(u));
      if (people.length === 0) return 'not_found';
      for (const uuid of people) {
        const res = await fetchFn(`${base}${encodeURIComponent(uuid)}/?delete_events=true`, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        await res.body?.cancel();
        if (!res.ok) throw new Error(`PostHog person delete responded ${res.status}`);
      }
      return 'deleted';
    },
  };
}
