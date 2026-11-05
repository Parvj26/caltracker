// Reads for the client's Today, Workouts and workout detail screens. Read only: nothing here writes a workout.
// RLS already limits workouts to the signed-in client's own (and only while they are still a client); the
// client_id filter also keeps library workouts out if a coach ever signs in to the phone app.
import { WORKOUT_TREE_SELECT, workoutRowToDoc } from '@caltracker/shared';
import type { IsoDate, Units, WorkoutDoc, WorkoutTreeRow } from '@caltracker/shared';
import { supabase } from './supabase';
import { WORKOUT_SUMMARY_SELECT, resolveVideoUrls, toWorkoutSummary, type WorkoutSummary, type WorkoutSummaryRow } from './workouts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out. Sign in again.');
  return id;
}

function summaries(data: unknown): WorkoutSummary[] {
  // The select string is a plain constant, so supabase-js cannot infer its shape; WorkoutSummaryRow describes it.
  return (data as WorkoutSummaryRow[]).map(toWorkoutSummary);
}

function summaryQuery(clientId: string) {
  return supabase.from('workouts').select(WORKOUT_SUMMARY_SELECT).eq('client_id', clientId);
}

/** The client's workouts from `from` to `to` inclusive, by date then name. */
export async function fetchWorkoutsBetween(from: IsoDate, to: IsoDate): Promise<WorkoutSummary[]> {
  const { data, error } = await summaryQuery(await myId())
    .gte('scheduled_on', from)
    .lte('scheduled_on', to)
    .order('scheduled_on')
    .order('name');
  if (error) throw new Error(`Could not load your workouts: ${error.message}`);
  return summaries(data);
}

/** The first workout after `after` (exclusive), or null when nothing else is scheduled. */
export async function fetchNextWorkout(after: IsoDate): Promise<WorkoutSummary | null> {
  const { data, error } = await summaryQuery(await myId())
    .gt('scheduled_on', after)
    .order('scheduled_on')
    .order('name')
    .limit(1);
  if (error) throw new Error(`Could not load your next workout: ${error.message}`);
  return summaries(data)[0] ?? null;
}

/** At most one workout from any date: enough for isFirstTimeClient(). */
export async function fetchAnyWorkout(): Promise<WorkoutSummary[]> {
  const { data, error } = await summaryQuery(await myId()).limit(1);
  if (error) throw new Error(`Could not load your workouts: ${error.message}`);
  return summaries(data);
}

/** One of the client's workouts with its form-video link per exercise, or null when missing or not theirs. */
export async function fetchWorkoutDetail(
  id: string,
): Promise<{ doc: WorkoutDoc; scheduledOn: IsoDate; videoUrls: Record<string, string> } | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase
    .from('workouts')
    .select(`${WORKOUT_TREE_SELECT}, workspace_id`)
    .eq('id', id)
    .eq('client_id', await myId())
    .maybeSingle();
  if (error) throw new Error(`Could not load this workout: ${error.message}`);
  if (!data) return null;
  // Built by concatenation, so supabase-js cannot infer the shape; WorkoutTreeRow describes it.
  const row = data as unknown as WorkoutTreeRow & { workspace_id: string };
  const doc = workoutRowToDoc(row);
  const exercises = doc.blocks.flatMap((b) => b.exercises);
  const ids = [...new Set(exercises.map((e) => e.exerciseId))];

  let videoUrls = resolveVideoUrls(exercises, [], []);
  if (ids.length > 0) {
    const [own, pinned] = await Promise.all([
      supabase.from('exercises').select('id, youtube_url').in('id', ids),
      supabase
        .from('exercise_overrides')
        .select('exercise_id, youtube_url')
        .eq('workspace_id', row.workspace_id)
        .in('exercise_id', ids),
    ]);
    // A missing video link is never worth failing the screen over: fall back to the YouTube search.
    videoUrls = resolveVideoUrls(exercises, own.data ?? [], pinned.data ?? []);
  }
  return { doc, scheduledOn: row.scheduled_on ?? '', videoUrls };
}

/** The signed-in user's own display units. */
export async function fetchMyUnits(): Promise<Units> {
  const { data, error } = await supabase.from('profiles').select('units').eq('id', await myId()).single();
  if (error) throw new Error(`Could not load your units: ${error.message}`);
  return data.units === 'lb' ? 'lb' : 'kg';
}

/** Saves the signed-in user's own display units (the database only lets anyone change their own). */
export async function setMyUnits(units: Units): Promise<void> {
  const { error } = await supabase.from('profiles').update({ units }).eq('id', await myId());
  if (error) throw new Error(`Could not save your units: ${error.message}`);
}

/** The name of the client's coach (the workspace owner), or null if there is none or it can't be read. */
export async function fetchMyCoachName(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_coach');
  if (error) return null; // Only decorates the welcome card; never block the screen on it.
  return data[0]?.coach_name ?? null;
}
