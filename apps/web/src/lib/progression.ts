import type { SupabaseClient } from '@supabase/supabase-js';
import { progressionHistoryFromRows, type Database, type ProgressionHistory } from '@caltracker/shared';

/**
 * The client's recent sessions of these exercises for one planned workout (progression_history), for the shared
 * Auto progression rules. Empty when the workout's program has Auto progression off or isn't from a program.
 */
export async function loadProgression(
  supabase: SupabaseClient<Database>,
  workoutId: string,
  exerciseIds: string[],
): Promise<ProgressionHistory> {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('progression_history', { p_workout_id: workoutId, p_exercise_ids: ids });
  if (error) throw new Error(`Could not load progression: ${error.message}`);
  return progressionHistoryFromRows(data);
}
