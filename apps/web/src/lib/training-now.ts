import type { SupabaseClient } from '@supabase/supabase-js';
import { LOG_TREE_SELECT, logRowToDoc, orderTrainingTabs } from '@caltracker/shared';
import type { Database, IsoDate, LogTreeRow, ProgressionHistory, WorkoutDoc, WorkoutLogDoc } from '@caltracker/shared';
import { avatarTone, initials } from '@/app/(coach)/clients/avatar';
import { loadLastTimes, type LastTimes } from '@/lib/coach-session';
import { exerciseImageUrl } from '@/lib/exercise-index';
import { loadProgression } from '@/lib/progression';
import { loadWorkoutDoc } from '@/lib/workouts';

// "Training now": every workout in progress for the coach's current clients, so the coach can watch one client live
// and switch to another (or to a session they log themselves) without leaving the page. Everything is read under the
// coach's own session, so row-level security limits it to their workspace; the workspace id comes from requireCoach().

type PaneBase = {
  logId: string;
  clientId: string;
  firstName: string;
  name: string;
  initials: string;
  tone: 'blue' | 'lime' | 'pink';
  startedAt: string;
  log: WorkoutLogDoc;
};

/** Someone else logs it (the client on their phone, or another coach): the coach watches it live. */
export type WatchPane = PaneBase & {
  kind: 'watch';
  holder: { kind: 'client' | 'other_coach'; name: string };
  /** Exercise id -> the thumbnail the exercise library shows (null for none). */
  photos: Record<string, string | null>;
  /** The stored awards.result, when the workout already has one (PRs). */
  award: unknown;
};

/** The coach logs it themselves (a session): the session logger, with what it needs. */
export type SessionPane = PaneBase & {
  kind: 'session';
  workout: WorkoutDoc;
  scheduledOn: IsoDate | null;
  lastTimes: LastTimes;
  progression: ProgressionHistory;
};

export type TrainingPane = WatchPane | SessionPane;

export type TrainingNow = {
  /** In tab order (orderTrainingTabs). */
  panes: TrainingPane[];
  /** Every in-progress log id the coach can see, including ones left out of the panes (the poll compares these). */
  inProgressIds: string[];
};

type Row = LogTreeRow & { client_id: string; logged_by: string | null };

export async function loadTrainingNow(
  supabase: SupabaseClient<Database>,
  { workspaceId, coachId }: { workspaceId: string; coachId: string },
): Promise<TrainingNow> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select(`client_id, logged_by, ${LOG_TREE_SELECT}`)
    .eq('workspace_id', workspaceId)
    .eq('status', 'in_progress')
    .order('started_at');
  if (error) throw new Error(`Could not load workouts in progress: ${error.message}`);
  // The select string is built by concatenation, so supabase-js cannot infer its shape; LogTreeRow describes it.
  const rows = data as unknown as Row[];
  const inProgressIds = rows.map((r) => r.id);
  if (rows.length === 0) return { panes: [], inProgressIds };

  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const otherLoggers = [...new Set(rows.flatMap((r) => (r.logged_by && r.logged_by !== r.client_id && r.logged_by !== coachId ? [r.logged_by] : [])))];
  const [members, profiles] = await Promise.all([
    // Current clients only (a removed client is no longer a member).
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client').in('user_id', clientIds),
    supabase.from('profiles').select('id, first_name, full_name').in('id', [...clientIds, ...otherLoggers]),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (profiles.error) throw new Error(`Could not load names: ${profiles.error.message}`);
  const current = new Set(members.data.map((m) => m.user_id));
  const profileOf = new Map(profiles.data.map((p) => [p.id, p]));
  const live = rows.filter((r) => current.has(r.client_id));

  const watched = live.filter((r) => r.logged_by !== coachId || r.workout_id === null);
  const exerciseIds = [...new Set(watched.flatMap((r) => logRowToDoc(r).blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId))))];
  const [exercises, awards] = await Promise.all([
    exerciseIds.length ? supabase.from('exercises').select('id, image_paths').in('id', exerciseIds) : Promise.resolve({ data: [], error: null }),
    watched.length ? supabase.from('awards').select('log_id, result').in('log_id', watched.map((r) => r.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (exercises.error) throw new Error(`Could not load exercise photos: ${exercises.error.message}`);
  if (awards.error) throw new Error(`Could not load awards: ${awards.error.message}`);
  const photoOf = new Map(exercises.data.map((e) => [e.id, e.image_paths[0] ? exerciseImageUrl(supabase, e.image_paths[0]) : null]));
  const awardOf = new Map(awards.data.map((a) => [a.log_id, a.result as unknown]));

  const panes = await Promise.all(
    live.map(async (r): Promise<TrainingPane | null> => {
      const log = logRowToDoc(r);
      const profile = profileOf.get(r.client_id);
      const name = profile?.full_name || 'Client';
      const firstName = profile?.first_name || name;
      const base: PaneBase = {
        logId: r.id,
        clientId: r.client_id,
        firstName,
        name,
        initials: initials(name),
        tone: avatarTone(r.client_id),
        startedAt: log.startedAt,
        log,
      };
      if (r.logged_by === coachId && r.workout_id !== null) {
        const workout = await loadWorkoutDoc(supabase, r.workout_id);
        if (!workout) return null;
        const ids = log.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId));
        const [lastTimes, progression] = await Promise.all([loadLastTimes(supabase, r.client_id, ids), loadProgression(supabase, r.workout_id, ids)]);
        return { ...base, kind: 'session', workout: workout.doc, scheduledOn: workout.scheduledOn, lastTimes, progression };
      }
      const byOtherCoach = r.logged_by !== null && r.logged_by !== r.client_id;
      const holderName = byOtherCoach ? profileOf.get(r.logged_by!)?.first_name || 'Another coach' : firstName;
      const photos: Record<string, string | null> = {};
      for (const b of log.blocks) for (const e of b.exercises) photos[e.exerciseId] = photoOf.get(e.exerciseId) ?? null;
      return {
        ...base,
        kind: 'watch',
        holder: { kind: byOtherCoach ? 'other_coach' : 'client', name: holderName },
        photos,
        award: awardOf.get(r.id) ?? null,
      };
    }),
  );
  return { panes: orderTrainingTabs(panes.filter((p): p is TrainingPane => p !== null)), inProgressIds };
}

/** The first of `candidates` (the one switched to, then the page's own log) that is training now, or null. */
export function pickActivePane(panes: readonly TrainingPane[], candidates: ReadonlyArray<string | null>): string | null {
  return candidates.find((id) => id !== null && panes.some((p) => p.logId === id)) ?? null;
}
