/**
 * Creates or updates the PO's PostHog dashboards (spec: usage analytics, "PostHog setup"). Safe to re-run:
 * dashboards and insights are found by name and updated in place.
 *
 * Needs POSTHOG_PERSONAL_API_KEY (operator's personal key; locally from the Keychain item
 * caltracker-posthog-personal-key) and POSTHOG_PROJECT_ID. Run: pnpm posthog:dashboards
 */

const HOST = process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const key = requireEnv('POSTHOG_PERSONAL_API_KEY');
const project = requireEnv('POSTHOG_PROJECT_ID');
const base = `${HOST}/api/projects/${project}`;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return (await res.json()) as T;
}

/** Hides the PO's own and test accounts (person property set by the apps). */
const NOT_INTERNAL = "ifNull(toString(person.properties.internal), '') != 'true'";
const TEST_FILTER = { filterTestAccounts: true };

type Query = Record<string, unknown>;
const table = (sql: string): Query => ({ kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query: sql } });
const viz = (source: Query): Query => ({ kind: 'InsightVizNode', source });
const ev = (event: string, extra: Query = {}): Query => ({ kind: 'EventsNode', event, name: event, ...extra });

interface Insight {
  name: string;
  description: string;
  query: Query;
}

const TASKS: Insight[] = [
  {
    name: 'Tasks: how hard is each job (last 30 days)',
    description: 'Per task: how many started and finished, typical taps, time, back presses and errors for finished ones.',
    query: table(`SELECT properties.task AS task,
  countIf(event = 'task_started') AS started,
  countIf(event = 'task_completed') AS finished,
  countIf(event = 'task_abandoned') AS gave_up,
  round(100 * countIf(event = 'task_completed') / nullIf(countIf(event = 'task_started'), 0)) AS finished_pct,
  median(if(event = 'task_completed', toFloat(properties.taps), NULL)) AS median_taps,
  round(median(if(event = 'task_completed', toFloat(properties.duration_ms), NULL)) / 1000) AS median_seconds,
  median(if(event = 'task_completed', toFloat(properties.back_count), NULL)) AS median_backs,
  round(avg(if(event = 'task_completed', toFloat(properties.error_count), NULL)), 2) AS avg_errors
FROM events
WHERE event IN ('task_started', 'task_completed', 'task_abandoned') AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_INTERNAL}
GROUP BY task ORDER BY started DESC`),
  },
  {
    name: 'Tasks: where people give up',
    description: 'The screen people were on when they left a task unfinished.',
    query: table(`SELECT properties.task AS task, properties.last_screen AS last_screen, count() AS times
FROM events WHERE event = 'task_abandoned' AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_INTERNAL}
GROUP BY task, last_screen ORDER BY times DESC LIMIT 25`),
  },
  {
    name: 'Workout logging: taps per set',
    description: 'For finished workouts: sets logged and taps per set (lower is easier).',
    query: table(`SELECT toStartOfWeek(timestamp) AS week, count() AS workouts, round(avg(toFloat(properties.sets_logged)), 1) AS avg_sets,
  round(median(toFloat(properties.taps_per_set)), 1) AS median_taps_per_set
FROM events WHERE event = 'task_completed' AND properties.task = 'log_workout' AND timestamp > now() - INTERVAL 90 DAY AND ${NOT_INTERNAL}
GROUP BY week ORDER BY week DESC`),
  },
];

const FRICTION: Insight[] = [
  {
    name: 'Friction over time',
    description: 'Rage taps/clicks, dead clicks, error messages and slow screens per day.',
    query: viz({
      kind: 'TrendsQuery',
      series: [ev('rage_tap'), ev('$rageclick'), ev('$dead_click'), ev('error_shown'), ev('slow_screen')],
      interval: 'day',
      dateRange: { date_from: '-30d' },
      ...TEST_FILTER,
    }),
  },
  {
    name: 'Friction by screen',
    description: 'Which screens have the most rage taps, errors and slow loads.',
    query: table(`SELECT coalesce(properties.screen, properties.$pathname) AS screen,
  countIf(event IN ('rage_tap', '$rageclick')) AS rage, countIf(event = '$dead_click') AS dead_clicks,
  countIf(event = 'error_shown') AS errors, countIf(event = 'slow_screen') AS slow,
  round(median(if(event = 'slow_screen', toFloat(properties.ms), NULL)) / 1000, 1) AS median_slow_seconds
FROM events WHERE event IN ('rage_tap', '$rageclick', '$dead_click', 'error_shown', 'slow_screen') AND timestamp > now() - INTERVAL 30 DAY AND ${NOT_INTERNAL}
GROUP BY screen ORDER BY rage + errors + slow + dead_clicks DESC LIMIT 25`),
  },
  {
    name: 'Exercise searches with no results',
    description: 'What coaches and clients searched for and did not find: exercises to add or rename.',
    query: table(`SELECT lower(properties.query) AS searched_for, count() AS times, uniq(person_id) AS people
FROM events WHERE event = 'exercise_search_no_results' AND timestamp > now() - INTERVAL 90 DAY AND ${NOT_INTERNAL}
GROUP BY searched_for ORDER BY times DESC LIMIT 50`),
  },
  {
    name: 'Quick undos',
    description: 'Things deleted within 30 seconds of being made (a sign of a mistake).',
    query: viz({ kind: 'TrendsQuery', series: [ev('quick_undo')], breakdownFilter: { breakdown: 'item_type', breakdown_type: 'event' }, interval: 'week', dateRange: { date_from: '-90d' }, ...TEST_FILTER }),
  },
];

const ACTIVITY: Insight[] = [
  {
    name: 'Weekly active people by role',
    description: 'Coaches and clients who did anything in each week.',
    query: viz({
      kind: 'TrendsQuery',
      series: [{ kind: 'EventsNode', event: null, name: 'All events', math: 'weekly_active' }],
      breakdownFilter: { breakdown: 'role', breakdown_type: 'person' },
      interval: 'week',
      dateRange: { date_from: '-90d' },
      ...TEST_FILTER,
    }),
  },
  {
    name: 'Gone quiet (no activity for 7+ days)',
    description: 'Everyone seen in the last 90 days who has not done anything for at least a week.',
    query: table(`SELECT person.properties.name AS name, person.properties.role AS role, person.properties.workspace_name AS coaching,
  max(timestamp) AS last_seen, dateDiff('day', max(timestamp), now()) AS days_quiet
FROM events WHERE timestamp > now() - INTERVAL 90 DAY AND ${NOT_INTERNAL} AND person.properties.role IS NOT NULL
GROUP BY name, role, coaching HAVING days_quiet >= 7 ORDER BY last_seen ASC`),
  },
  {
    name: 'Last seen (everyone)',
    description: 'Each coach and client with their last activity and how active they were this week.',
    query: table(`SELECT person.properties.name AS name, person.properties.role AS role, person.properties.workspace_name AS coaching,
  max(timestamp) AS last_seen, uniqIf(toDate(timestamp), timestamp > now() - INTERVAL 7 DAY) AS active_days_this_week
FROM events WHERE timestamp > now() - INTERVAL 90 DAY AND ${NOT_INTERNAL} AND person.properties.role IS NOT NULL
GROUP BY name, role, coaching ORDER BY last_seen DESC`),
  },
  {
    name: 'New, returning and dormant people',
    description: 'Each week: who is new, who came back, and who stopped (dormant).',
    query: viz({ kind: 'LifecycleQuery', series: [{ kind: 'EventsNode', event: null, name: 'All events' }], interval: 'week', dateRange: { date_from: '-90d' }, ...TEST_FILTER }),
  },
  {
    name: 'Notifications opened',
    description: 'Push notifications tapped, by kind.',
    query: viz({ kind: 'TrendsQuery', series: [ev('notification_opened')], breakdownFilter: { breakdown: 'kind', breakdown_type: 'event' }, interval: 'week', dateRange: { date_from: '-90d' }, ...TEST_FILTER }),
  },
];

const taskEvent = (event: string, task: string): Query =>
  ev(event, { properties: [{ key: 'task', value: [task], operator: 'exact', type: 'event' }] });

const JOIN_UP: Insight[] = [
  {
    name: 'Client join-up: invite opened → joined → first workout',
    description: 'Clients from opening the invite on the phone to finishing a first workout (within 14 days).',
    query: viz({
      kind: 'FunnelsQuery',
      series: [taskEvent('task_started', 'join_from_invite'), taskEvent('task_completed', 'join_from_invite'), taskEvent('task_completed', 'log_workout')],
      funnelsFilter: { funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day' },
      dateRange: { date_from: '-90d' },
      ...TEST_FILTER,
    }),
  },
  {
    name: 'Coach first setup: first visit → first client invited',
    description: 'New coaches from their first page view to sending their first invite (within 14 days).',
    query: viz({
      kind: 'FunnelsQuery',
      series: [ev('$pageview'), ev('invite_sent')],
      funnelsFilter: { funnelWindowInterval: 14, funnelWindowIntervalUnit: 'day' },
      dateRange: { date_from: '-90d' },
      ...TEST_FILTER,
    }),
  },
  {
    name: 'Invites sent per week',
    description: 'Client invites coaches sent.',
    query: viz({ kind: 'TrendsQuery', series: [ev('invite_sent')], interval: 'week', dateRange: { date_from: '-90d' }, ...TEST_FILTER }),
  },
];

const DASHBOARDS: { name: string; description: string; pinned: boolean; insights: Insight[] }[] = [
  { name: 'CalTracker · Activity', description: 'Who is active, who has gone quiet.', pinned: true, insights: ACTIVITY },
  { name: 'CalTracker · Tasks', description: 'How many taps and how long each job takes, and where people give up.', pinned: true, insights: TASKS },
  { name: 'CalTracker · Friction', description: 'Rage taps, errors, slow screens and failed searches.', pinned: true, insights: FRICTION },
  { name: 'CalTracker · Join-up', description: 'From invite to first workout.', pinned: true, insights: JOIN_UP },
];

interface Paged<T> {
  results: T[];
  next: string | null;
}

async function main(): Promise<void> {
  // Hide internal accounts in every chart by default (the "Filter out internal and test users" toggle).
  // Needs the project:write scope; without it, print how to set the filter by hand and carry on.
  try {
    await api('PATCH', '/', {
      test_account_filters: [{ key: 'internal', value: ['true'], operator: 'is_not', type: 'person' }],
      test_account_filters_default_checked: true,
    });
    console.log('Internal-account filter set as the default.');
  } catch (e) {
    console.warn(`Could not set the internal-account filter (${e instanceof Error ? e.message.slice(0, 80) : 'error'}).`);
    console.warn('Set it in PostHog: Settings → Project → Product analytics → Filter out internal and test users: add person property internal "is not" true, and tick "Enable by default".');
  }

  const existing = await api<Paged<{ id: number; name: string }>>('GET', '/dashboards/?limit=200');
  for (const d of DASHBOARDS) {
    const found = existing.results.find((x) => x.name === d.name);
    const dashboard = found
      ? await api<{ id: number }>('PATCH', `/dashboards/${found.id}/`, { description: d.description, pinned: d.pinned })
      : await api<{ id: number }>('POST', '/dashboards/', { name: d.name, description: d.description, pinned: d.pinned });
    const insights = await api<Paged<{ id: number; name: string }>>('GET', `/insights/?dashboards=[${dashboard.id}]&limit=200`);
    for (const i of d.insights) {
      const match = insights.results.find((x) => x.name === i.name);
      const body = { name: i.name, description: i.description, query: i.query, dashboards: [dashboard.id] };
      if (match) await api('PATCH', `/insights/${match.id}/`, body);
      else await api('POST', '/insights/', body);
    }
    console.log(`${found ? 'Updated' : 'Created'} ${d.name} (${d.insights.length} charts): ${HOST}/project/${project}/dashboard/${dashboard.id}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
