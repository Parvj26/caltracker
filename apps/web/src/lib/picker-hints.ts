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

/** What the hints are made from, read in parallel with the page's other queries; pickerHints() shapes it. */
export type PickerHistory = { used: (string | null)[] | null; lastProgramId: string | null };

/**
 * The raw history behind the workout pickers' "Recent" and "Most used", and the program picker's default, from data
 * the app already keeps: single workouts this coach put on clients' calendars (copies with created_by = the coach
 * and no program assignment), newest first, by their library workout; and this coach's latest program assignment.
 * Read under the coach's own session (RLS) and filtered to their workspace, so nothing from another workspace can
 * show up. Shortcuts only: a failed read gives no shortcuts instead of failing the page.
 */
export async function loadPickerHistory(supabase: SupabaseClient<Database>, workspaceId: string, coachId: string): Promise<PickerHistory> {
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
  return {
    used: copies.error ? null : copies.data.map((c) => c.source_workout_id),
    lastProgramId: assignment.error ? null : (assignment.data?.program_id ?? null),
  };
}

/** The pickers' hints from the history, limited to workouts still in the library. */
export function pickerHints(history: PickerHistory, library: readonly { id: string }[]): PickerHints {
  const hints = history.used ? workoutHints(history.used, new Set(library.map((w) => w.id))) : { recent: [], mostUsed: [] };
  return { ...hints, lastProgramId: history.lastProgramId };
}
