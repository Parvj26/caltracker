'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CustomExerciseInput, ExerciseOverrideInput, codeForMessage, type Database } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type SaveOverrideOutcome = { ok: true } | ActionFailure;


// Not .upsert(): its conflict update would also write workspace_id/exercise_id, which coaches lack UPDATE rights on.
async function writeOverride(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  exerciseId: string,
  youtubeUrl: string | null,
  coachNotes: string | null,
) {
  const updated = await supabase
    .from('exercise_overrides')
    .update({ youtube_url: youtubeUrl, coach_notes: coachNotes })
    .eq('workspace_id', workspaceId)
    .eq('exercise_id', exerciseId)
    .select('exercise_id');
  if (updated.error || updated.data.length > 0) return updated;
  return supabase
    .from('exercise_overrides')
    .insert({ workspace_id: workspaceId, exercise_id: exerciseId, youtube_url: youtubeUrl, coach_notes: coachNotes });
}

export async function saveOverride(
  exerciseId: string,
  input: { youtubeUrl: string | null; coachNotes: string | null },
): Promise<SaveOverrideOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  const parsed = ExerciseOverrideInput.safeParse({ exerciseId, ...input });
  if (!parsed.success) return fail(codeForMessage(parsed.error.issues[0]?.message, 'field_format'), 'action:exercises.saveOverride');
  const { youtubeUrl, coachNotes } = parsed.data;

  const supabase = await createServerSupabase();
  const exists = await supabase
    .from('exercises')
    .select('id')
    .eq('id', parsed.data.exerciseId)
    .eq('source', 'builtin')
    .maybeSingle();
  if (exists.error || !exists.data) return fail('exercise_not_found', 'action:exercises.saveOverride');

  const result =
    youtubeUrl === null && coachNotes === null
      ? await supabase
          .from('exercise_overrides')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('exercise_id', parsed.data.exerciseId)
      : await writeOverride(supabase, workspaceId, parsed.data.exerciseId, youtubeUrl, coachNotes);
  if (result.error) return fail('exercise_save_failed', 'action:exercises.saveOverride');

  revalidatePath(`/exercises/${parsed.data.exerciseId}`);
  return { ok: true };
}

export async function createCustomExercise(input: CustomExerciseInput): Promise<{ id: string }> {
  const { workspaceId } = await requireCoach();
  const parsed = CustomExerciseInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the exercise details.');
  const v = parsed.data;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      workspace_id: workspaceId,
      source: 'custom',
      name: v.name,
      tracking_type: v.trackingType,
      primary_muscles: v.primaryMuscles,
      equipment: v.equipment,
      instructions: v.instructions,
      youtube_url: v.youtubeUrl,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error("Couldn't create the exercise. Please try again.");

  revalidatePath('/exercises');
  return { id: data.id };
}

export async function updateCustomExercise(id: string, input: CustomExerciseInput): Promise<void> {
  const { workspaceId } = await requireCoach();
  const idCheck = ExerciseOverrideInput.shape.exerciseId.safeParse(id);
  const parsed = CustomExerciseInput.safeParse(input);
  if (!idCheck.success) throw new Error("Couldn't find that exercise.");
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the exercise details.');
  const v = parsed.data;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('exercises')
    .update({
      name: v.name,
      tracking_type: v.trackingType,
      primary_muscles: v.primaryMuscles,
      equipment: v.equipment,
      instructions: v.instructions,
      youtube_url: v.youtubeUrl,
    })
    .eq('id', idCheck.data)
    .eq('workspace_id', workspaceId)
    .eq('source', 'custom')
    .select('id');
  if (error || !data || data.length === 0) throw new Error("Couldn't save the exercise. Please try again.");

  revalidatePath('/exercises');
  revalidatePath(`/exercises/${idCheck.data}`);
}
