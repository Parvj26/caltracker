import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, LAST_WORKOUT_LOOKBACK_DAYS } from '@caltracker/shared';
import type { Database, HomeAssignment, HomeWorkout, IsoDate } from '@caltracker/shared';

/** A current client as the server sees it: timestamps are still instants, the browser turns them into its own dates. */
export type HomeClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  /** workspace_members.created_at */
  joinedAt: string;
  /** Latest completed log, within the last 31 days; null if none. */
  lastFinishedAt: string | null;
  /** Date of the latest coach-entered body scan (a client's own weight entries don't count); null if none. */
  lastScanOn: IsoDate | null;
};
/** Planned workouts carry plain calendar dates (scheduled_on), so they need no time zone conversion. */
export type HomeWorkoutRow = HomeWorkout;
export type HomeData = { workouts: HomeWorkoutRow[]; clients: HomeClientRow[]; assignments: HomeAssignment[] };

const WINDOW_DAYS = 8;
const PAGE = 1000; // PostgREST's default max rows per response

/** Reads every row of a query, a page at a time, so a busy coach never silently loses rows past the server cap. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

/**
 * Everything the coach home needs, in a fixed number of queries (never one per client). Reads go through RLS with
 * the coach's own session. The window is wide enough for any browser time zone.
 */
export async function loadHomeData(supabase: SupabaseClient<Database>, workspaceId: string, utcToday: IsoDate): Promise<HomeData> {
  const since = new Date(Date.now() - (LAST_WORKOUT_LOOKBACK_DAYS + 1) * 86_400_000).toISOString();

  const [members, workouts, finished, assignments, scans] = await Promise.all([
    // Current clients only: a removed client is no longer a workspace member, which is how the Clients page does it.
    supabase.from('workspace_members').select('user_id, created_at').eq('workspace_id', workspaceId).eq('role', 'client'),
    readAll(
      (from, to) =>
        supabase
          .from('workouts')
          .select('id, client_id, name, scheduled_on, workout_logs(id, status, started_at, finished_at, last_activity_at)')
          .eq('workspace_id', workspaceId)
          .gte('scheduled_on', addDays(utcToday, -WINDOW_DAYS))
          .lte('scheduled_on', addDays(utcToday, WINDOW_DAYS))
          .order('scheduled_on')
          .order('id')
          .range(from, to),
      'workouts',
    ),
    readAll(
      (from, to) =>
        supabase
          .from('workout_logs')
          .select('client_id, finished_at')
          .eq('workspace_id', workspaceId)
          .eq('status', 'completed')
          .gte('finished_at', since)
          .order('finished_at', { ascending: false })
          .order('id')
          .range(from, to),
      'recent workouts',
    ),
    supabase
      .from('program_assignments')
      .select('id, client_id, start_date, end_date, cancelled_on')
      .eq('workspace_id', workspaceId)
      .is('cancelled_on', null)
      .gte('end_date', addDays(utcToday, -1)),
    readAll(
      (from, to) =>
        supabase
          .from('body_measurements')
          .select('client_id, measured_on')
          .eq('workspace_id', workspaceId)
          .eq('source', 'coach')
          .order('measured_on', { ascending: false })
          .order('id')
          .range(from, to),
      'body scans',
    ),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (assignments.error) throw new Error(`Could not load programs: ${assignments.error.message}`);

  // No direct foreign key links workspace_members to profiles, so load the names separately (as the Clients page does).
  const ids = members.data.map((m) => m.user_id);
  const profiles = ids.length ? await supabase.from('profiles').select('id, first_name, last_name').in('id', ids) : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const nameOf = new Map((profiles.data ?? []).map((p) => [p.id, p]));

  const latest = new Map<string, string>();
  for (const l of finished) if (l.finished_at && !latest.has(l.client_id)) latest.set(l.client_id, l.finished_at); // newest first

  const lastScan = new Map<string, IsoDate>();
  for (const m of scans) if (!lastScan.has(m.client_id)) lastScan.set(m.client_id, m.measured_on); // newest first

  return {
    clients: members.data.map((m) => ({
      id: m.user_id,
      firstName: nameOf.get(m.user_id)?.first_name ?? '',
      lastName: nameOf.get(m.user_id)?.last_name ?? '',
      joinedAt: m.created_at ?? new Date().toISOString(), // never null in practice (it defaults to now)
      lastFinishedAt: latest.get(m.user_id) ?? null,
      lastScanOn: lastScan.get(m.user_id) ?? null,
    })),
    // A library workout has no client or date; the filters above only let client calendar entries through.
    workouts: workouts.flatMap((w) =>
      w.client_id && w.scheduled_on
        ? [
            {
              id: w.id,
              clientId: w.client_id,
              name: w.name,
              scheduledOn: w.scheduled_on,
              logs: w.workout_logs.map((l) => ({ id: l.id, status: l.status, startedAt: l.started_at, finishedAt: l.finished_at, lastActivityAt: l.last_activity_at })),
            },
          ]
        : [],
    ),
    assignments: assignments.data.flatMap((a) =>
      a.end_date ? [{ id: a.id, clientId: a.client_id, startDate: a.start_date, endDate: a.end_date, cancelledOn: a.cancelled_on }] : [],
    ),
  };
}
