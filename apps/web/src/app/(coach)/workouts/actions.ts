'use server';

import { revalidatePath } from 'next/cache';
import { WorkoutDoc } from '@caltracker/shared';
import type { ExercisePick } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { escapeLike } from '../exercises/filters';

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
  // A client's copy shows on their calendar.
  revalidatePath('/clients/[id]', 'page');
  return { ok: true, id: data };
}

export async function deleteWorkout(id: string): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return { ok: false, error: "Couldn't find that workout." };
  const supabase = await createServerSupabase();
  // Program slots go with it (on delete cascade). Clients' calendar copies are separate rows and stay.
  const { data, error } = await supabase.from('workouts').delete().eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error) return { ok: false, error: "Couldn't delete. Please try again." };
  if (data.length === 0) return { ok: false, error: "Couldn't find that workout." };

  revalidatePath('/workouts');
  revalidatePath('/programs', 'layout');
  revalidatePath('/clients/[id]', 'page');
  return { ok: true };
}

/** How many programs use this library workout (a program using it twice counts once). */
export async function countProgramUses(id: string): Promise<number> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return 0;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('program_workouts')
    .select('program_id')
    .eq('workout_id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(`Could not count programs: ${error.message}`);
  return new Set(data.map((r) => r.program_id)).size;
}

/** Built-in exercises plus this workspace's own, by name. */
export async function searchExercises(query: string): Promise<ExercisePick[]> {
  const { workspaceId } = await requireCoach();
  const q = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  const supabase = await createServerSupabase();
  let request = supabase
    .from('exercises')
    .select('id, name, tracking_type')
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
  if (q) request = request.ilike('name', `%${escapeLike(q)}%`);
  const { data, error } = await request.order('name', { ascending: true }).limit(20);
  if (error) throw new Error(`Could not search exercises: ${error.message}`);
  return data.map((e) => ({ id: e.id, name: e.name, trackingType: e.tracking_type }));
}
