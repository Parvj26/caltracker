/** The owner Overview: shape of admin_owner_overview (20261120000200_admin_owner_overview.sql) and its wording. */

export type WeekPair = { this_week: number; last_week: number };

export type OwnerOverview = {
  growth: { new_coaches: WeekPair; clients_added: WeekPair; invites_sent: WeekPair; invites_joined: WeekPair };
  usage: {
    workouts: WeekPair;
    meals: WeekPair;
    metrics: WeekPair & { apple_health_this_week: number };
    new_connections: WeekPair;
    posts: WeekPair;
    messages: WeekPair;
  };
  health: {
    last_push_run_at: string | null;
    last_push_status: string | null;
    push_failed_24h: number;
    old_builds: { min_build: number; people: number; builds: number[] };
  };
};

/** "Show test accounts" is on when the URL has ?test=1. */
export const showTestAccounts = (param: string | string[] | undefined) => param === '1';

/** The same page with the toggle flipped (other params kept). */
export function testToggleHref(path: string, params: Record<string, string | string[] | undefined>, on: boolean): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === 'test' || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) next.append(k, one);
  }
  if (!on) next.set('test', '1');
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Growth tiles: "same as last week", "▲ 1 vs last week". Usage boxes use the short form: "same as last". */
export function weekTrend(p: WeekPair, short = false): string {
  const diff = p.this_week - p.last_week;
  const last = short ? 'last' : 'last week';
  if (diff === 0) return `same as ${last}`;
  return `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs ${last}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type HealthItem = { tag: string; main: string; sub: string };

const PUSH_LATE_MS = 2 * 60 * 60 * 1000;

/**
 * Product health lists only what's wrong. Empty = "Notifications and errors: all good".
 * - Not sending: the push sender (the push-send job) last ran over 2 h ago or never ran; or it ran recently but failed.
 * - Failed: notifications that failed in the last 24 h.
 * - Old build: people whose latest known build is below the minimum (none until phones send their build).
 */
export function productHealthItems(h: OwnerOverview['health'], now: Date, agoText: (iso: string) => string): HealthItem[] {
  const items: HealthItem[] = [];
  const ran = h.last_push_run_at ? Date.parse(h.last_push_run_at) : NaN;
  const late = Number.isNaN(ran) || now.getTime() - ran > PUSH_LATE_MS;
  if (late) {
    items.push({
      tag: 'Not sending',
      main: 'Notifications not sent in 2 h',
      sub: h.last_push_run_at ? `Last run ${agoText(h.last_push_run_at)}` : 'The sender has not run',
    });
  } else if (h.last_push_status === 'failed') {
    // It ran recently, so "not sent in 2 h" would be untrue: say the last run failed.
    items.push({ tag: 'Not sending', main: 'Last notification run failed', sub: `Ran ${agoText(h.last_push_run_at!)}` });
  }
  if (h.push_failed_24h > 0) {
    items.push({ tag: 'Failed', main: `${plural(h.push_failed_24h, 'notification')} failed`, sub: 'Last 24 h' });
  }
  const ob = h.old_builds;
  if (ob.min_build > 0 && ob.people > 0) {
    const builds = [...ob.builds].sort((a, b) => a - b);
    items.push({
      tag: 'Old build',
      main: `${plural(ob.people, 'person', 'people')} on ${builds.length === 1 ? 'build' : 'builds'} ${builds.join(', ')}`,
      sub: `Minimum is ${ob.min_build}`,
    });
  }
  // TODO(posthog): dead clicks and server errors are not shown yet: they need PostHog server access from the admin site.
  // They only appear past a threshold (up on last week or over 50), so leaving them out hides nothing most weeks.
  return items;
}

/** The Coaches "Clients / limit" cell's muted part (no plans yet, so no limit). */
export const NO_PLAN = 'no plan yet';
