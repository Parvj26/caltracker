'use server';

import { revalidatePath } from 'next/cache';
import { WorkoutDoc } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type SaveIssue = { path: (string | number)[]; message: string };
export type SaveWorkoutOutcome = { ok: true; id: string } | { ok: false; error: string; issues?: SaveIssue[] };

const GENERIC_ERROR = "Couldn't save. Please try again.";
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
  revalidatePath('/clients/[clientId]', 'page');
  revalidatePath('/clients/[clientId]/workouts/[workoutId]', 'page');
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
  revalidatePath('/clients/[clientId]', 'page');
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
  await requireCoach();
  if (!UUID.test(exerciseId) || typeof on !== 'boolean') return { ok: false };
  const supabase = await createServerSupabase();
  if (on) {
    const { error } = await supabase
      .from('exercise_favorites')
      .upsert({ exercise_id: exerciseId }, { onConflict: 'coach_id,exercise_id', ignoreDuplicates: true });
    return { ok: !error };
  }
  const { error } = await supabase.from('exercise_favorites').delete().eq('exercise_id', exerciseId);
  return { ok: !error };
}
