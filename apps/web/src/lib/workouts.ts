import type { SupabaseClient } from '@supabase/supabase-js';
import { WORKOUT_TREE_SELECT, workoutRowToDoc } from '@caltracker/shared';
import type { Database, IsoDate, WorkoutDoc, WorkoutTreeRow } from '@caltracker/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One workout (library or client copy) as a builder doc, or null when it doesn't exist or isn't visible. */
export async function loadWorkoutDoc(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ doc: WorkoutDoc; clientId: string | null; scheduledOn: IsoDate | null } | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase.from('workouts').select(WORKOUT_TREE_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load workout: ${error.message}`);
  if (!data) return null;
  // The select string is built by concatenation, so supabase-js cannot infer its shape; WorkoutTreeRow describes it
  // (and tree.test.ts checks the mapping against it).
  const row = data as unknown as WorkoutTreeRow;
  return { doc: workoutRowToDoc(row), clientId: row.client_id, scheduledOn: row.scheduled_on };
}
