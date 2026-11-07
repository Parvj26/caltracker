'use server';

import { revalidatePath } from 'next/cache';
import { WorkoutDoc, duplicateWorkoutDoc } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadWorkoutDoc } from '@/lib/workouts';

export type SaveIssue = { path: (string | number)[]; message: string };
export type SaveWorkoutOutcome = { ok: true; id: string } | { ok: false; error: string; issues?: SaveIssue[] };

const GENERIC_ERROR = "Couldn't save. Please try again.";
const ALREADY_DONE =
  "This workout is already done, so its plan stays as it was (the log was done against it). Open its log to edit the results.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveWorkout(doc: unknown): Promise<SaveWorkoutOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  const parsed = WorkoutDoc.safeParse(doc);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
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
  if (done.error) return { ok: false, error: GENERIC_ERROR };
  if (done.data.length > 0) return { ok: false, error: ALREADY_DONE };

  const { data, error } = await supabase.rpc('save_workout', { p_workspace_id: workspaceId, p_doc: parsed.data });
  if (error) {
    // 23514: a document guard in save_workout; its message is written for the coach.
    if (error.code === '23514') return { ok: false, error: error.message };
    if (error.code === '42501') return { ok: false, error: "You can't edit this workout." };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath('/workouts');
  revalidatePath(`/workouts/${data}`);
  // A client's copy shows on their calendar and in its editor.
  revalidatePath('/clients/[clientId]', 'layout');
  revalidatePath('/clients/[clientId]/workouts/[workoutId]', 'page');
  return { ok: true, id: data };
}

export type DuplicateOutcome = { ok: true; id: string } | { ok: false; error: string };

const NOT_IN_LIBRARY = "Couldn't find that workout in your library. It may have been deleted.";

/**
 * Copies a library workout (as last saved) into a new library workout named "<name> (copy)", in the coach's own
 * workspace. Only this workspace's library workouts can be copied: the lookup filters by the coach's workspace on
 * top of RLS, and save_workout refuses a workspace the caller doesn't coach.
 */
export async function duplicateWorkout(id: string): Promise<DuplicateOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return { ok: false, error: NOT_IN_LIBRARY };
  const supabase = await createServerSupabase();
  const { data: own, error: ownError } = await supabase
    .from('workouts')
    .select('id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('client_id', null)
    .maybeSingle();
  if (ownError) return { ok: false, error: "Couldn't copy. Please try again." };
  if (!own) return { ok: false, error: NOT_IN_LIBRARY };

  const loaded = await loadWorkoutDoc(supabase, id);
  if (!loaded) return { ok: false, error: NOT_IN_LIBRARY };
  const copy = WorkoutDoc.safeParse(duplicateWorkoutDoc(loaded.doc, () => crypto.randomUUID()));
  if (!copy.success) return { ok: false, error: 'Open this workout, fix the highlighted fields and save it, then copy it.' };

  const { data, error } = await supabase.rpc('save_workout', { p_workspace_id: workspaceId, p_doc: copy.data });
  if (error) {
    if (error.code === '23514') return { ok: false, error: error.message };
    return { ok: false, error: "Couldn't copy. Please try again." };
  }
  revalidatePath('/workouts');
  return { ok: true, id: data };
}

export async function deleteWorkout(id: string): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return { ok: false, error: "Couldn't find that workout." };
  const supabase = await createServerSupabase();
  // Program slots go with it (on delete cascade). Clients' calendar copies are separate rows and stay.
  // Library workouts only: a client's calendar copy is edited and deleted from that client's calendar.
  const { data, error } = await supabase
    .from('workouts')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('client_id', null)
    .select('id');
  if (error) return { ok: false, error: "Couldn't delete. Please try again." };
  if (data.length === 0) return { ok: false, error: "Couldn't find that workout in your library. It may already be deleted." };

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
