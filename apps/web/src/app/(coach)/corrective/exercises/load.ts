import 'server-only';
import { BUILTIN_CORRECTIVE_NAMES } from '@caltracker/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { builtinItems, coachItems, mergeLibrary, type CoachCorrectiveRow, type LibraryItem } from '@/lib/corrective-library';

/**
 * The corrective library for the signed-in coach: their own corrective exercises (with muscles and exercise) and the
 * built-in defaults whose exercise is in the library, merged (yours first, a tagged built-in once).
 */
export async function loadCorrectiveLibrary(workspaceId: string): Promise<{ items: LibraryItem[]; builtins: LibraryItem[] }> {
  const supabase = await createServerSupabase();
  const [own, tags, builtinExercises] = await Promise.all([
    supabase
      .from('corrective_exercises')
      .select('id, exercise_id, direction, default_sets, default_reps, default_seconds, each_side, created_at, exercises(name, tracking_type, image_paths, source)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    supabase.from('corrective_exercise_muscles').select('corrective_id, muscle_id, side').eq('workspace_id', workspaceId),
    // Case-insensitive name match: each name quoted (some have brackets), with LIKE's wildcards escaped.
    supabase
      .from('exercises')
      .select('id, name, tracking_type, image_paths')
      .eq('source', 'builtin')
      .ilikeAnyOf(
        'name',
        BUILTIN_CORRECTIVE_NAMES.map((n) => `"${n.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/"/g, '\\"')}"`),
      ),
  ]);
  if (own.error) throw new Error(`Could not load corrective exercises: ${own.error.message}`);
  if (tags.error) throw new Error(`Could not load corrective muscles: ${tags.error.message}`);
  if (builtinExercises.error) throw new Error(`Could not load built-in exercises: ${builtinExercises.error.message}`);

  const byId = new Map<string, { muscle_id: string; side: string }[]>();
  for (const t of tags.data) {
    const list = byId.get(t.corrective_id) ?? [];
    list.push(t);
    byId.set(t.corrective_id, list);
  }
  const rows: CoachCorrectiveRow[] = own.data.map((r) => ({
    id: r.id,
    exercise_id: r.exercise_id,
    direction: r.direction,
    default_sets: r.default_sets,
    default_reps: r.default_reps,
    default_seconds: r.default_seconds,
    each_side: r.each_side,
    muscles: byId.get(r.id) ?? [],
    exercise: r.exercises,
  }));
  const builtins = builtinItems(builtinExercises.data);
  return { items: mergeLibrary(coachItems(rows), builtins), builtins };
}
