import type { SupabaseClient } from '@supabase/supabase-js';
import { LOG_TREE_SELECT, logRowToDoc, safeTimeZone, strengthExercises, strengthSeries } from '@caltracker/shared';
import type { Database, LogTreeRow, StrengthPoint, WorkoutLogDoc } from '@caltracker/shared';

/** The most recent finished workouts read for the charts. */
export const STRENGTH_LOG_LIMIT = 300;

export type ClientStrength = Array<{ exerciseId: string; name: string; points: StrengthPoint[] }>;

/** Each lift's series, with workout days read in the client's own time zone (as the phone does). */
export function buildStrength(logs: readonly WorkoutLogDoc[], timeZone: string): ClientStrength {
  return strengthExercises(logs).map((e) => ({ ...e, points: strengthSeries(logs, e.exerciseId, timeZone) }));
}

/** The client's estimated-1RM series for every lift they have done, read through the coach's own session. */
export async function loadClientStrength(supabase: SupabaseClient<Database>, workspaceId: string, clientId: string): Promise<ClientStrength> {
  const [{ data, error }, profile] = await Promise.all([
    supabase
    .from('workout_logs')
    .select(LOG_TREE_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(STRENGTH_LOG_LIMIT),
    supabase.from('profiles').select('time_zone').eq('id', clientId).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load strength history: ${error.message}`);
  // A profile the coach cannot read (or a bad zone) falls back to UTC.
  const timeZone = safeTimeZone(profile.data?.time_zone);
  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  const logs = (data as unknown as LogTreeRow[]).map(logRowToDoc);
  return buildStrength(logs, timeZone);
}
