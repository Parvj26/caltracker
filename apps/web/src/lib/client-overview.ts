import type { SupabaseClient } from '@supabase/supabase-js';
import { STICKERS, addDays } from '@caltracker/shared';
import type { Database, HomeWorkout, IsoDate, OverviewScan } from '@caltracker/shared';

/**
 * Everything the client Overview shows, in a fixed number of queries, read with the coach's own session (RLS limits
 * every row to the coach's workspace). Dates that depend on "today" are worked out in the browser from these rows,
 * as on Home: the server (UTC) loads a window a day wider either side.
 */

export const UPDATES_SHOWN = 8;

export type OverviewNote = { id: string; body: string; createdAt: string; updatedAt: string };
export type OverviewEvent =
  | { kind: 'workout'; id: string; at: string; name: string; plannedOn: IsoDate | null; byCoach: boolean }
  | { kind: 'scan'; id: string; at: string; measuredOn: IsoDate; source: 'coach' | 'client'; weightKg: number | null }
  | { kind: 'sticker'; id: string; at: string; name: string };

export type ClientOverview = {
  clientId: string;
  firstName: string;
  /** The client's planned workouts from 31 days back to 15 days ahead (UTC), with their logs. */
  workouts: HomeWorkout[];
  /** When the client finished workouts they added themselves (last 31 days). */
  addedFinishedAt: string[];
  highlights: { stickers: number; volumeKg: number; personalBests: number; workouts: number };
  scans: OverviewScan[];
  events: OverviewEvent[];
  profile: { email: string | null; timeZone: string | null; joinedAt: string | null };
  goal: { goal: string; targetDate: IsoDate | null } | null;
  limitations: string;
  notes: OverviewNote[];
};

const NOTES_LIMIT = 200;
const SCANS_LIMIT = 500;

export async function loadClientOverview(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  client: { id: string; firstName: string; removedAt: string | null },
  utcToday: IsoDate,
): Promise<ClientOverview> {
  const clientId = client.id;
  const since = `${addDays(utcToday, -32)}T00:00:00Z`;
  const [workouts, unplanned, stats, stickerCount, recentStickers, scans, recentScans, recentLogs, profile, member, invite, past, goal, limitations, notes] =
    await Promise.all([
      supabase
        .from('workouts')
        .select('id, name, scheduled_on, workout_logs(id, status, started_at, finished_at, last_activity_at)')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .gte('scheduled_on', addDays(utcToday, -31))
        .lte('scheduled_on', addDays(utcToday, 15))
        .order('scheduled_on'),
      // Workouts the client added themselves (as on the calendar: no planned workout, and none of its exercises came
      // from a plan that was deleted since).
      supabase
        .from('workout_logs')
        .select('id, finished_at, log_blocks(log_exercises(planned_workout_exercise_id))')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .eq('status', 'completed')
        .is('workout_id', null)
        .gte('finished_at', since),
      supabase.from('client_stats').select('lifetime_volume_kg, pr_count, workouts').eq('workspace_id', workspaceId).eq('client_id', clientId).maybeSingle(),
      supabase.from('sticker_awards').select('sticker_key', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('client_id', clientId),
      supabase
        .from('sticker_awards')
        .select('sticker_key, first_earned_at')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .order('first_earned_at', { ascending: false })
        .limit(UPDATES_SHOWN),
      supabase
        .from('body_measurements')
        .select('id, measured_on, created_at, source, body_measurement_values(metric_key, value)')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .order('measured_on', { ascending: false })
        // The newest 500 scans (about 40 years of monthly InBody tests): "All time" on the card covers these.
        .limit(SCANS_LIMIT),
      // Updates shows scans by when they were entered, so ask for the newest entries on their own.
      supabase
        .from('body_measurements')
        .select('id, measured_on, created_at, source, body_measurement_values(metric_key, value)')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(UPDATES_SHOWN),
      supabase
        .from('workout_logs')
        .select('id, name, finished_at, logged_by, workouts(scheduled_on)')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .eq('status', 'completed')
        .order('finished_at', { ascending: false })
        .limit(UPDATES_SHOWN),
      supabase.from('profiles').select('time_zone').eq('id', clientId).maybeSingle(),
      supabase.from('workspace_members').select('created_at').eq('workspace_id', workspaceId).eq('user_id', clientId).maybeSingle(),
      // Client emails live in auth.users, which RLS hides: the accepted invite has it (as on the Clients page).
      supabase
        .from('client_invites')
        .select('email')
        .eq('workspace_id', workspaceId)
        .eq('accepted_by', clientId)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('past_clients').select('email, joined_at').eq('workspace_id', workspaceId).eq('user_id', clientId).maybeSingle(),
      supabase.from('client_goals').select('goal, target_date').eq('workspace_id', workspaceId).eq('client_id', clientId).maybeSingle(),
      supabase.from('client_limitations').select('body').eq('workspace_id', workspaceId).eq('client_id', clientId).maybeSingle(),
      supabase
        .from('client_notes')
        .select('id, body, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(NOTES_LIMIT),
    ]);
  for (const [what, r] of [
    ['workouts', workouts],
    ['client-added workouts', unplanned],
    ['totals', stats],
    ['stickers', stickerCount],
    ['stickers', recentStickers],
    ['body scans', scans],
    ['recent body scans', recentScans],
    ['recent workouts', recentLogs],
    ['profile', profile],
    ['membership', member],
    ['email', invite],
    ['past client', past],
    ['goal', goal],
    ['limitations', limitations],
    ['notes', notes],
  ] as const) {
    if (r.error) throw new Error(`Could not load ${what}: ${r.error.message}`);
  }

  const stickerName = new Map(STICKERS.map((s) => [s.key, s.name]));
  const scanRows: OverviewScan[] = (scans.data ?? []).map((s) => ({
    measuredOn: s.measured_on,
    createdAt: s.created_at,
    values: Object.fromEntries(s.body_measurement_values.map((v) => [v.metric_key, Number(v.value)])),
  }));

  const events: OverviewEvent[] = [
    ...(recentLogs.data ?? []).flatMap((l): OverviewEvent[] =>
      l.finished_at
        ? [{ kind: 'workout', id: `log-${l.id}`, at: l.finished_at, name: l.name, plannedOn: l.workouts?.scheduled_on ?? null, byCoach: l.logged_by !== null && l.logged_by !== clientId }]
        : [],
    ),
    ...(recentScans.data ?? []).map(
      (s): OverviewEvent => ({
        kind: 'scan',
        id: `scan-${s.id}`,
        at: s.created_at,
        measuredOn: s.measured_on,
        source: s.source === 'client' ? 'client' : 'coach',
        weightKg: ((v) => (v ? Number(v.value) : null))(s.body_measurement_values.find((v) => v.metric_key === 'weight_kg')),
      }),
    ),
    ...(recentStickers.data ?? []).map(
      (s): OverviewEvent => ({ kind: 'sticker', id: `sticker-${s.sticker_key}`, at: s.first_earned_at, name: stickerName.get(s.sticker_key) ?? s.sticker_key }),
    ),
  ];

  return {
    clientId,
    firstName: client.firstName,
    workouts: (workouts.data ?? []).flatMap((w) =>
      w.scheduled_on
        ? [
            {
              id: w.id,
              clientId,
              name: w.name,
              scheduledOn: w.scheduled_on,
              logs: w.workout_logs.map((l) => ({
                id: l.id,
                status: l.status,
                startedAt: l.started_at,
                finishedAt: l.finished_at,
                lastActivityAt: l.last_activity_at,
              })),
            },
          ]
        : [],
    ),
    addedFinishedAt: (unplanned.data ?? []).flatMap((l) =>
      l.finished_at && l.log_blocks.every((b) => b.log_exercises.every((e) => e.planned_workout_exercise_id === null)) ? [l.finished_at] : [],
    ),
    highlights: {
      stickers: stickerCount.count ?? 0,
      volumeKg: Number(stats.data?.lifetime_volume_kg ?? 0),
      personalBests: stats.data?.pr_count ?? 0,
      workouts: stats.data?.workouts ?? 0,
    },
    scans: scanRows,
    events,
    profile: {
      email: invite.data?.email ?? past.data?.email ?? null,
      // A removed client's profile is hidden from the coach, so their zone is unknown.
      timeZone: profile.data?.time_zone || null,
      joinedAt: member.data?.created_at ?? past.data?.joined_at ?? null,
    },
    goal: goal.data ? { goal: goal.data.goal, targetDate: goal.data.target_date } : null,
    limitations: limitations.data?.body ?? '',
    notes: (notes.data ?? []).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, updatedAt: n.updated_at })),
  };
}
