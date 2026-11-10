import { posthogEventLabel, type TimelineEvent } from '@caltracker/shared';

type PosthogEnv = { POSTHOG_PERSONAL_KEY?: string | undefined; POSTHOG_PROJECT_ID?: string | undefined };

const HOST = 'https://us.posthog.com';

// The last 30 days of one person's events. The id is passed as a HogQL value, never pasted into the query.
const QUERY = `select event, timestamp, properties from events
where distinct_id = {distinct_id} and timestamp > now() - interval 30 day
order by timestamp desc
limit 200`;

function props(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * One person's tracked app events from PostHog, as timeline rows (noise dropped). Server only: it uses the personal
 * API key (a Worker secret). Never throws: a missing key, an HTTP error, a timeout or an odd answer returns an Error,
 * and the page shows database events only. Call it only after admin_log_timeline_view succeeded (the audit row).
 */
export async function fetchPosthogTimeline(
  distinctId: string,
  deps: { env?: PosthogEnv; fetch?: typeof fetch } = {},
): Promise<TimelineEvent[] | Error> {
  const env = deps.env ?? process.env;
  const key = env.POSTHOG_PERSONAL_KEY;
  const project = env.POSTHOG_PROJECT_ID;
  if (!key || !project) return new Error('PostHog is not configured');
  const fetchFn = deps.fetch ?? fetch;
  try {
    const response = await fetchFn(`${HOST}/api/projects/${encodeURIComponent(project)}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: QUERY, values: { distinct_id: distinctId } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return new Error(`PostHog answered ${response.status}`);
    const body = (await response.json()) as { results?: unknown };
    if (!Array.isArray(body.results)) return new Error('PostHog answer had no results');
    const events: TimelineEvent[] = [];
    for (const row of body.results) {
      if (!Array.isArray(row)) continue;
      const [event, at, properties] = row as unknown[];
      if (typeof event !== 'string' || typeof at !== 'string') continue;
      const label = posthogEventLabel(event, props(properties));
      if (label) events.push({ at, source: 'app', label });
    }
    return events;
  } catch (e) {
    return e instanceof Error ? e : new Error('PostHog request failed');
  }
}
