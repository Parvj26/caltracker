import type { SupabaseClient } from '@supabase/supabase-js';
import { coachSessionState } from '@caltracker/shared';
import type { CoachSessionState, Database, ResultSet, SetType, SessionLog } from '@caltracker/shared';

// Reads for the coach's session logging page (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md).
// Everything goes through the coach's own session, so row-level security limits it to their workspace.

/** Per exercise id: the completed sets of the client's most recent finished log that has any ("Last time: …"). */
export type LastTimes = Record<string, ResultSet[]>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The client's last results for these exercises (coach_last_results: the same rule the phone uses for itself). */
export async function loadLastTimes(supabase: SupabaseClient<Database>, clientId: string, exerciseIds: string[]): Promise<LastTimes> {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('coach_last_results', { p_client_id: clientId, p_exercise_ids: ids });
  if (error) throw new Error(`Could not load last results: ${error.message}`);
  const out: LastTimes = {};
  // Rows come ordered by exercise, then block, exercise and set position. Numerics may arrive as strings and any
  // actual may be null, whatever the generated types say.
  for (const row of data as Array<Record<string, unknown>>) {
    (out[row.exercise_id as string] ??= []).push({
      setType: row.set_type as SetType,
      actualReps: num(row.actual_reps),
      actualWeightKg: num(row.actual_weight_kg),
      actualDurationS: num(row.actual_duration_s),
      actualDistanceM: num(row.actual_distance_m),
    });
  }
  return out;
}

/** Who is logging this planned workout, if anyone (single active logger). */
export async function loadSessionState(
  supabase: SupabaseClient<Database>,
  input: { clientId: string; workoutId: string; coachId: string },
): Promise<CoachSessionState> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, workout_id, status, logged_by, name')
    .eq('client_id', input.clientId)
    .or(`workout_id.eq.${input.workoutId},status.eq.in_progress`)
    .neq('status', 'discarded')
    .order('started_at', { ascending: false });
  if (error) throw new Error(`Could not load the session: ${error.message}`);
  const logs: SessionLog[] = data.map((l) => ({ id: l.id, workoutId: l.workout_id, status: l.status, loggedBy: l.logged_by, name: l.name }));
  return coachSessionState({ ...input, logs });
}
