import type { SupabaseClient } from '@supabase/supabase-js';
import { workoutHints, type WorkoutHints } from '@caltracker/shared';
import type { Database } from '@caltracker/shared';

/** How many of the coach's latest hand-added workouts "Recent" and "Most used" look at. */
const LOOKBACK = 300;

export type PickerHints = WorkoutHints & {
  /** The program this coach assigned most recently (still in the library), or null: the program picker's default. */
  lastProgramId: string | null;
};

export const NO_HINTS: PickerHints = { recent: [], mostUsed: [], lastProgramId: null };

/**
 * The workout pickers' "Recent" and "Most used", and the program picker's default, from data the app already keeps:
 * single workouts this coach put on clients' calendars (copies with created_by = the coach and no program
 * assignment), newest first, by their library workout; and this coach's latest program assignment. Read under the
 * coach's own session (RLS) and filtered to their workspace, so nothing from another workspace can show up.
 */
export async function loadPickerHints(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  coachId: string,
  library: readonly { id: string }[],
): Promise<PickerHints> {
  const [copies, assignment] = await Promise.all([
    supabase
      .from('workouts')
      .select('source_workout_id')
      .eq('workspace_id', workspaceId)
      .eq('created_by', coachId)
      .not('client_id', 'is', null)
      .is('assignment_id', null)
      .not('source_workout_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LOOKBACK),
    supabase
      .from('program_assignments')
      .select('program_id')
      .eq('workspace_id', workspaceId)
      .eq('created_by', coachId)
      .not('program_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // Shortcuts only: if they can't load, the picker still works with the full list.
  const hints = copies.error ? { recent: [], mostUsed: [] } : workoutHints(copies.data.map((c) => c.source_workout_id), new Set(library.map((w) => w.id)));
  return { ...hints, lastProgramId: assignment.error ? null : (assignment.data?.program_id ?? null) };
}
