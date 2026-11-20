'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CustomExerciseInput,
  ExerciseOverrideInput,
  codeForMessage,
  exerciseNameKey,
  sameExerciseName,
  type Database,
  type LibraryTrackingType,
} from '@caltracker/shared';
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

export type QuickCreateOutcome =
  | { ok: true; id: string; name: string; trackingType: LibraryTrackingType }
  | (ActionFailure & { existing?: { id: string; name: string } });

/** Escapes LIKE's wildcards in typed text. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * "+ Create '<query>'" in the exercise search (when nothing matched): a custom exercise for this workspace with just
 * a name and a tracking type. Refused when a built-in or this workspace's own exercise already has the same name
 * (case and spacing ignored); `existing` names it, so the search can offer it instead.
 */
export async function quickCreateExercise(input: { name: string; trackingType: string }): Promise<QuickCreateOutcome> {
  const { workspaceId } = await requireCoach();
  const parsed = CustomExerciseInput.safeParse({ name: input.name, trackingType: input.trackingType, instructions: [] });
  if (!parsed.success) return fail(codeForMessage(parsed.error.issues[0]?.message, 'field_format'), 'action:exercises.quickCreateExercise');
  const v = parsed.data;
  const name = v.name.replace(/\s+/g, ' ');

  const supabase = await createServerSupabase();
  // Same words in the same order, any case or spacing: the database narrows it down, the shared rule decides.
  const pattern = exerciseNameKey(name).split(' ').map(likeLiteral).join('%');
  const { data: found, error: findError } = await supabase
    .from('exercises')
    .select('id, name')
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .ilike('name', pattern)
    .limit(20);
  if (findError) return fail('exercise_create_failed', 'action:exercises.quickCreateExercise');
  const existing = found.find((e) => sameExerciseName(e.name, name));
  if (existing) return { ...fail('exercise_name_taken', 'action:exercises.quickCreateExercise'), existing };

  const { data, error } = await supabase
    .from('exercises')
    .insert({
      workspace_id: workspaceId,
      source: 'custom',
      name,
      tracking_type: v.trackingType,
      primary_muscles: [],
      equipment: null,
      instructions: [],
      youtube_url: null,
    })
    .select('id')
    .single();
  if (error || !data) return fail('exercise_create_failed', 'action:exercises.quickCreateExercise');
  revalidatePath('/exercises');
  return { ok: true, id: data.id, name, trackingType: v.trackingType };
}
