import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, awardPrEvents, LAST_WORKOUT_LOOKBACK_DAYS, MISSED_RUN_LOOKBACK_DAYS, PLANNED_AHEAD_DAYS } from '@caltracker/shared';
import type { CheckAssignment, Database, HomeWorkout, IsoDate, PrEvent } from '@caltracker/shared';

/** A current client as the server sees it: timestamps are still instants, the browser turns them into its own dates. */
export type HomeClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  /** workspace_members.created_at */
  joinedAt: string;
  /** Latest completed log within the lookback (plus a day for time zones); null if none. */
  lastFinishedAt: string | null;
  /** That log's workout name. */
  lastWorkoutName: string | null;
  /** Date of the latest coach-entered body scan (a client's own weight entries don't count); null if none. */
  lastScanOn: IsoDate | null;
};
/** Planned workouts carry plain calendar dates (scheduled_on), so they need no time zone conversion. */
export type HomeWorkoutRow = HomeWorkout & { assignmentId: string | null };
export type HomeData = {
  workouts: HomeWorkoutRow[];
  clients: HomeClientRow[];
  assignments: CheckAssignment[];
  /** Personal records from recent workouts; the browser counts the ones in its own week. */
  prs: PrEvent[];
};

/** Awards are read from this many days back (filtering on awards.created_at is a safe superset of the PRs achieved that week): a week plus the most any time zone is ahead of or behind UTC. */
const PR_WINDOW_DAYS = 9;
const PAGE = 1000; // PostgREST's default max rows per response

/**
 * Reads every row of a query, a page at a time, so a busy coach never silently loses rows past the server cap. It
 * stops only at an empty page: a short page is not proof of the end, because the server's row cap may be lower than
 * PAGE.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
    from += data.length;
  }
}

/**
 * Everything the coach home needs, in a fixed number of queries (never one per client). Reads go through RLS with
 * the coach's own session. The window is wide enough for any browser time zone.
 */
export async function loadHomeData(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  utcToday: IsoDate,
  /** How far back to look for each client's latest workout. The Clients list looks further back than Home. */
  lastWorkoutLookbackDays: number = LAST_WORKOUT_LOOKBACK_DAYS,
  /**
   * Days of planned workouts to read around UTC's today (each plus a day for any browser time zone). Home needs the
   * daily check's 14 back and 7 ahead; the Clients list reads 4 weeks back and further ahead for the next workout.
   */
  window: { backDays: number; aheadDays: number } = { backDays: MISSED_RUN_LOOKBACK_DAYS, aheadDays: PLANNED_AHEAD_DAYS },
): Promise<HomeData> {
  const since = new Date(Date.now() - (lastWorkoutLookbackDays + 1) * 86_400_000).toISOString();

  const prSince = new Date(Date.now() - PR_WINDOW_DAYS * 86_400_000).toISOString();

  // Current clients only: a removed client is no longer a workspace member, which is how the Clients page does it.
  const membersQuery = supabase.from('workspace_members').select('user_id, created_at').eq('workspace_id', workspaceId).eq('role', 'client');
  // No direct foreign key links workspace_members to profiles, so load the names separately (as the Clients page does),
  // as soon as the client list is back rather than after every paged read below.
  const namesQuery = Promise.resolve(membersQuery).then(async (members) => {
    const ids = members.data?.map((m) => m.user_id) ?? [];
    return ids.length ? await supabase.from('profiles').select('id, first_name, last_name').in('id', ids) : { data: [], error: null };
  });

  const [members, profiles, workouts, finished, assignments, awards, scans] = await Promise.all([
    membersQuery,
    namesQuery,
    readAll(
      (from, to) =>
        supabase
          .from('workouts')
          .select('id, client_id, name, scheduled_on, assignment_id, workout_logs(id, status, started_at, finished_at, last_activity_at, logged_by)')
          .eq('workspace_id', workspaceId)
          .gte('scheduled_on', addDays(utcToday, -(window.backDays + 1)))
          .lte('scheduled_on', addDays(utcToday, window.aheadDays + 1))
          .order('scheduled_on')
          .order('id')
          .range(from, to),
      'workouts',
    ),
    readAll(
      (from, to) =>
        supabase
          .from('workout_logs')
          .select('client_id, finished_at, name')
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
      // Cancelled ones too: a program cancelled from a future date still runs until then (the shared rules work that out).
      .select('id, client_id, program_name, start_date, end_date, cancelled_on')
      .eq('workspace_id', workspaceId)
      .gte('end_date', addDays(utcToday, -1)),
    readAll(
      (from, to) =>
        supabase
          .from('awards')
          .select('log_id, client_id, result')
          .eq('workspace_id', workspaceId)
          .gte('created_at', prSince)
          .order('created_at', { ascending: false })
          .order('log_id')
          .range(from, to),
      'personal records',
    ),
    // One row per client: their latest coach-entered scan (never every scan).
    supabase.rpc('latest_coach_scans', { p_workspace_id: workspaceId }),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (assignments.error) throw new Error(`Could not load programs: ${assignments.error.message}`);

  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const nameOf = new Map((profiles.data ?? []).map((p) => [p.id, p]));

  const latest = new Map<string, { at: string; name: string }>();
  for (const l of finished) if (l.finished_at && !latest.has(l.client_id)) latest.set(l.client_id, { at: l.finished_at, name: l.name }); // newest first

  if (scans.error) throw new Error(`Could not load body scans: ${scans.error.message}`);
  const lastScan = new Map<string, IsoDate>(scans.data.map((m) => [m.client_id, m.measured_on]));

  return {
    prs: awards.flatMap((a) => awardPrEvents(a.client_id, a.result)),
    clients: members.data.map((m) => ({
      id: m.user_id,
      firstName: nameOf.get(m.user_id)?.first_name ?? '',
      lastName: nameOf.get(m.user_id)?.last_name ?? '',
      joinedAt: m.created_at ?? new Date().toISOString(), // never null in practice (it defaults to now)
      lastFinishedAt: latest.get(m.user_id)?.at ?? null,
      lastWorkoutName: latest.get(m.user_id)?.name ?? null,
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
              assignmentId: w.assignment_id,
              logs: w.workout_logs.map((l) => ({ id: l.id, status: l.status, startedAt: l.started_at, finishedAt: l.finished_at, lastActivityAt: l.last_activity_at, loggedBy: l.logged_by })),
            },
          ]
        : [],
    ),
    assignments: assignments.data.flatMap((a) =>
      a.end_date ? [{ id: a.id, clientId: a.client_id, programName: a.program_name, startDate: a.start_date, endDate: a.end_date, cancelledOn: a.cancelled_on }] : [],
    ),
  };
}
