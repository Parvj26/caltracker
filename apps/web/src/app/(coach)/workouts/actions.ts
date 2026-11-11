'use server';

import { revalidatePath } from 'next/cache';
import { WorkoutDoc, duplicateWorkoutDoc } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadWorkoutDoc } from '@/lib/workouts';

export type SaveIssue = { path: (string | number)[]; message: string };
export type SaveWorkoutOutcome = { ok: true; id: string } | (ActionFailure & { issues?: SaveIssue[] });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveWorkout(doc: unknown): Promise<SaveWorkoutOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  const parsed = WorkoutDoc.safeParse(doc);
  if (!parsed.success) {
    return {
      ...fail('workout_fields_invalid', 'action:workouts.saveWorkout'),
      issues: parsed.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: i.message,
      })),
    };
  }

  const supabase = await createServerSupabase();
  // A client's workout that has a completed log keeps its plan, so planned vs. actual on the log still matches what
  // the client was given. Any other one saves on any day, a missed past one included. (Library workouts never have
  // logs.)
  const done = await supabase
    .from('workout_logs')
    .select('id')
    .eq('workout_id', parsed.data.id)
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed')
    .limit(1);
  if (done.error) return fail('workout_save_failed', 'action:workouts.saveWorkout');
  if (done.data.length > 0) return fail('workout_already_done', 'action:workouts.saveWorkout');

  const { data, error } = await supabase.rpc('save_workout', { p_workspace_id: workspaceId, p_doc: parsed.data });
  if (error) {
    // 23514: a document guard in save_workout. Its text can name rows, so only the code goes back.
    if (error.code === '23514') return fail(/already done/i.test(error.message) ? 'workout_already_done' : 'workout_invalid', 'action:workouts.saveWorkout');
    if (error.code === '42501') return fail('workout_edit_denied', 'action:workouts.saveWorkout');
    return fail('workout_save_failed', 'action:workouts.saveWorkout');
  }

  revalidatePath('/workouts');
  revalidatePath(`/workouts/${data}`);
  // A client's copy shows on their calendar and in its editor.
  revalidatePath('/clients/[clientId]', 'layout');
  revalidatePath('/clients/[clientId]/workouts/[workoutId]', 'page');
  return { ok: true, id: data };
}

export type DuplicateOutcome = { ok: true; id: string } | ActionFailure;

/**
 * Copies a library workout (as last saved) into a new library workout named "<name> (copy)", in the coach's own
 * workspace. Only this workspace's library workouts can be copied: the lookup filters by the coach's workspace on
 * top of RLS, and save_workout refuses a workspace the caller doesn't coach.
 */
export async function duplicateWorkout(id: string): Promise<DuplicateOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return fail('workout_not_in_library', 'action:workouts.duplicateWorkout');
  const supabase = await createServerSupabase();
  const { data: own, error: ownError } = await supabase
    .from('workouts')
    .select('id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('client_id', null)
    .maybeSingle();
  if (ownError) return fail('workout_copy_failed', 'action:workouts.duplicateWorkout');
  if (!own) return fail('workout_not_in_library', 'action:workouts.duplicateWorkout');

  const loaded = await loadWorkoutDoc(supabase, id);
  if (!loaded) return fail('workout_not_in_library', 'action:workouts.duplicateWorkout');
  const copy = WorkoutDoc.safeParse(duplicateWorkoutDoc(loaded.doc, () => crypto.randomUUID()));
  if (!copy.success) return fail('workout_copy_invalid', 'action:workouts.duplicateWorkout');

  const { data, error } = await supabase.rpc('save_workout', { p_workspace_id: workspaceId, p_doc: copy.data });
  if (error) {
    if (error.code === '23514') return fail('workout_invalid', 'action:workouts.duplicateWorkout');
    return fail('workout_copy_failed', 'action:workouts.duplicateWorkout');
  }
  revalidatePath('/workouts');
  return { ok: true, id: data };
}

export async function deleteWorkout(id: string): Promise<{ ok: true } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return fail('workout_not_found', 'action:workouts.deleteWorkout');
  const supabase = await createServerSupabase();
  // Program slots go with it (on delete cascade). Clients' calendar copies are separate rows and stay, except that
  // Live Sync removes untouched upcoming copies from programs that have it on (the slots changed).
  // Library workouts only: a client's calendar copy is edited and deleted from that client's calendar.
  const { data, error } = await supabase
    .from('workouts')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('client_id', null)
    .select('id');
  if (error) return fail('workout_delete_failed', 'action:workouts.deleteWorkout');
  if (data.length === 0) return fail('workout_already_deleted', 'action:workouts.deleteWorkout');

  revalidatePath('/workouts');
  revalidatePath('/programs', 'layout');
  revalidatePath('/clients/[clientId]', 'layout');
  return { ok: true };
}

/** How many programs use this library workout (a program using it twice counts once). Client copies count 0. */
export async function countProgramUses(id: string): Promise<number> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return 0;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('program_workouts')
    .select('program_id, workouts!inner(client_id)')
    .eq('workout_id', id)
    .eq('workspace_id', workspaceId)
    .is('workouts.client_id', null);
  if (error) throw new Error(`Could not count programs: ${error.message}`);
  return new Set(data.map((r) => r.program_id)).size;
}

/** Set whether the signed-in coach has starred an exercise. Favourites are personal, not shared across the workspace. */
export async function setFavourite(exerciseId: string, on: boolean): Promise<{ ok: boolean }> {
  const { userId } = await requireCoach();
  if (!UUID.test(exerciseId) || typeof on !== 'boolean') return { ok: false };
  const supabase = await createServerSupabase();
  if (on) {
    const { error } = await supabase
      .from('exercise_favorites')
      .upsert({ exercise_id: exerciseId }, { onConflict: 'coach_id,exercise_id', ignoreDuplicates: true });
    return { ok: !error };
  }
  // RLS already limits this to the coach's own rows; the filter says so too.
  const { error } = await supabase.from('exercise_favorites').delete().eq('exercise_id', exerciseId).eq('coach_id', userId);
  return { ok: !error };
}
