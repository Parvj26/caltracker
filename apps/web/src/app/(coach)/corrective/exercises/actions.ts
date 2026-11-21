'use server';

import { revalidatePath } from 'next/cache';
import { checkCorrectiveTags } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = '/corrective/exercises';

export type SaveCorrectiveInput = {
  /** null adds a new one. */
  id: string | null;
  exerciseId: string;
  direction: string;
  muscles: { muscleId: string; side: string }[];
  dose: { sets: number; reps: number | null; seconds: number | null; eachSide: boolean };
};

/**
 * Adds or changes one of the coach's corrective exercises (board AS8) through save_corrective_exercise, which writes
 * the row and replaces its muscle tags in one go. The workspace is the signed-in coach's, never the browser's.
 */
export async function saveCorrective(input: SaveCorrectiveInput): Promise<{ ok: true; id: string } | ActionFailure> {
  const where = 'action:corrective.saveCorrective';
  const { workspaceId } = await requireCoach();
  const tags = checkCorrectiveTags(input);
  if (!tags || !UUID.test(input.exerciseId) || (input.id !== null && !UUID.test(input.id))) return fail('corrective_invalid', where);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('save_corrective_exercise', {
    p_workspace_id: workspaceId,
    // The generated type says string; the function takes null for a new one.
    p_id: input.id as string,
    p_exercise_id: input.exerciseId,
    p_direction: tags.direction,
    p_sets: tags.dose.sets,
    p_reps: tags.dose.reps as number,
    p_seconds: tags.dose.seconds as number,
    p_each_side: tags.dose.eachSide,
    p_muscles: tags.muscles.map((m) => ({ muscle_id: m.muscleId, side: m.side })),
  });
  if (error) {
    if (error.code === '23505') return fail('corrective_exists', where);
    if (error.code === '42501') return fail('corrective_denied', where);
    if (error.code === '22023' || error.code === '23514' || error.code === '23503') return fail('corrective_invalid', where);
    return fail('corrective_save_failed', where);
  }
  revalidatePath(PATH);
  return { ok: true, id: data };
}

/** Removes the corrective tag (the exercise itself stays in the library). */
export async function deleteCorrective(id: string): Promise<{ ok: true } | ActionFailure> {
  const where = 'action:corrective.deleteCorrective';
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return fail('corrective_invalid', where);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('corrective_exercises').delete().eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error || data.length === 0) return fail('corrective_delete_failed', where);
  revalidatePath(PATH);
  return { ok: true };
}
