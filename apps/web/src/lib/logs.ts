import type { SupabaseClient } from '@supabase/supabase-js';
import { LOG_TREE_SELECT, logRowToDoc } from '@caltracker/shared';
import type { Database, LogTreeRow, WorkoutLogDoc } from '@caltracker/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The same nested select and mapping the phone uses (both live in packages/shared). */
export { LOG_TREE_SELECT, logRowToDoc };

/**
 * One workout log as a doc, or null when it doesn't exist or isn't visible to the signed-in coach (row-level
 * security limits the read to the coach's own workspace).
 */
export async function loadLog(
  supabase: SupabaseClient<Database>,
  logId: string,
): Promise<{
  log: WorkoutLogDoc;
  clientId: string;
  plannedWorkoutId: string | null;
  correctedAt: string | null;
  /** Who logged it: the client on the phone, or their coach in a session; null once that account is deleted. */
  loggedBy: string | null;
} | null> {
  if (!UUID.test(logId)) return null;
  const { data, error } = await supabase
    .from('workout_logs')
    .select(`client_id, corrected_at, logged_by, ${LOG_TREE_SELECT}`)
    .eq('id', logId)
    .maybeSingle();
  if (error) throw new Error(`Could not load workout log: ${error.message}`);
  if (!data) return null;
  // The select string is built by concatenation, so supabase-js cannot infer its shape; LogTreeRow describes it.
  const row = data as unknown as LogTreeRow & { client_id: string; corrected_at: string | null; logged_by: string | null };
  return { log: logRowToDoc(row), clientId: row.client_id, plannedWorkoutId: row.workout_id, correctedAt: row.corrected_at, loggedBy: row.logged_by };
}
