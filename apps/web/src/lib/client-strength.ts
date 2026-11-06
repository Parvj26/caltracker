import type { SupabaseClient } from '@supabase/supabase-js';
import { LOG_TREE_SELECT, logRowToDoc, strengthExercises, strengthSeries } from '@caltracker/shared';
import type { Database, LogTreeRow, StrengthPoint } from '@caltracker/shared';

/** The most recent finished workouts read for the charts. */
export const STRENGTH_LOG_LIMIT = 300;

export type ClientStrength = Array<{ exerciseId: string; name: string; points: StrengthPoint[] }>;

/** The client's estimated-1RM series for every lift they have done, read through the coach's own session. */
export async function loadClientStrength(supabase: SupabaseClient<Database>, workspaceId: string, clientId: string): Promise<ClientStrength> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select(LOG_TREE_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(STRENGTH_LOG_LIMIT);
  if (error) throw new Error(`Could not load strength history: ${error.message}`);
  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  const logs = (data as unknown as LogTreeRow[]).map(logRowToDoc);
  return strengthExercises(logs).map((e) => ({ ...e, points: strengthSeries(logs, e.exerciseId) }));
}
