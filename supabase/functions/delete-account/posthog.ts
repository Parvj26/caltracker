// Asks PostHog to forget a deleted user: the person and their events. Needs a personal API key with person write
// access (POSTHOG_PERSONAL_API_KEY, a server secret, never the public project key the apps use) and the project id.
// Without them this is skipped. The apps identify people by their Supabase user id, so that is the distinct id.

export interface PosthogEraser {
  /** 'ambiguous': more than one person has this distinct id, so none was deleted (the caller logs it). */
  erase(distinctId: string): Promise<'deleted' | 'not_found' | 'ambiguous'>;
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
      const body = (await found.json()) as { results?: { uuid?: unknown; distinct_ids?: unknown }[] };
      // Never trust the query filter alone: only a person whose own distinct ids include this one is a match.
      const matches = (body.results ?? []).filter(
        (r): r is { uuid: string; distinct_ids: string[] } =>
          typeof r.uuid === 'string' && Array.isArray(r.distinct_ids) && r.distinct_ids.includes(distinctId),
      );
      if (matches.length === 0) return 'not_found';
      // Two people claiming one id should not happen; deleting either could erase someone else, so delete none.
      if (matches.length > 1) return 'ambiguous';
      const res = await fetchFn(`${base}${encodeURIComponent(matches[0]!.uuid)}/?delete_events=true`, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`PostHog person delete responded ${res.status}`);
      return 'deleted';
    },
  };
}
