'use server';

import { revalidatePath } from 'next/cache';
import { PROGRAM_WEEKS_MAX, ProgramInput } from '@caltracker/shared';
import type { Database } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Every action takes the workspace from the signed-in coach (requireCoach), never from the browser, and filters by
// it on top of RLS. Slot actions throw on failure: the grid has already shown the change and rolls it back.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
/** Positions are smallint in the database; a cell never holds anywhere near this many. */
const POSITION_MAX = 9999;

export type UpdateProgramOutcome = { ok: true; removedSlots: number } | { ok: false; error: string };

export async function createProgram(input: ProgramInput): Promise<{ id: string }> {
  const { workspaceId } = await requireCoach();
  const parsed = ProgramInput.parse(input);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('programs')
    .insert({ workspace_id: workspaceId, name: parsed.name, description: parsed.description, weeks: parsed.weeks })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create the program: ${error.message}`);
  revalidatePath('/programs');
  return { id: data.id };
}

export async function updateProgram(id: string, input: ProgramInput): Promise<UpdateProgramOutcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return { ok: false, error: "Couldn't find that program." };
  const parsed = ProgramInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the details.' };

  const supabase = await createServerSupabase();
  const { data: current, error: readError } = await supabase
    .from('programs')
    .select('weeks')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (readError) return { ok: false, error: "Couldn't save. Please try again." };
  if (!current) return { ok: false, error: "Couldn't find that program. It may have been deleted." };

  // Length first: set_program_weeks deletes slots past the new end and changes weeks in one transaction.
  let removedSlots = 0;
  if (current.weeks !== parsed.data.weeks) {
    const { data: removed, error } = await supabase.rpc('set_program_weeks', {
      p_program_id: id,
      p_weeks: parsed.data.weeks,
    });
    if (error) return { ok: false, error: "Couldn't change the number of weeks. Please try again." };
    removedSlots = removed;
  }

  const { error } = await supabase
    .from('programs')
    .update({ name: parsed.data.name, description: parsed.data.description })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) return { ok: false, error: "Couldn't save the name and description. Please try again." };

  revalidatePath('/programs');
  revalidatePath(`/programs/${id}`);
  return { ok: true, removedSlots };
}

export async function deleteProgram(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return { ok: false, error: "Couldn't find that program." };
  const supabase = await createServerSupabase();
  // Slots go with it (on delete cascade). Clients who were assigned it keep their calendar copies.
  const { data, error } = await supabase.from('programs').delete().eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error) return { ok: false, error: "Couldn't delete. Please try again." };
  if (data.length === 0) return { ok: false, error: "Couldn't find that program. It may already be deleted." };
  revalidatePath('/programs');
  return { ok: true };
}

/** How many slots sit in weeks after `weeks`: what shrinking the program to `weeks` would remove. */
export async function countSlotsBeyondWeek(programId: string, weeks: number): Promise<number> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(programId) || !isInt(weeks, 0, PROGRAM_WEEKS_MAX)) return 0;
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from('program_workouts')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', programId)
    .eq('workspace_id', workspaceId)
    .gt('week', weeks);
  if (error) throw new Error(`Could not count workouts: ${error.message}`);
  return count ?? 0;
}

/** The program's length, or null when it isn't in this coach's workspace. */
async function programWeeks(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  programId: string,
  workspaceId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('programs')
    .select('weeks')
    .eq('id', programId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the program: ${error.message}`);
  return data?.weeks ?? null;
}

/** Puts a library workout on a day. The browser makes the id, so the grid can show the chip before this returns. */
export async function addProgramWorkout(input: {
  id: string;
  programId: string;
  week: number;
  day: number;
  workoutId: string;
}): Promise<void> {
  const { workspaceId } = await requireCoach();
  const { id, programId, week, day, workoutId } = input;
  if (!isUuid(id) || !isUuid(programId) || !isUuid(workoutId) || !isInt(day, 1, 7) || !isInt(week, 1, PROGRAM_WEEKS_MAX)) {
    throw new Error('Invalid slot');
  }
  const supabase = await createServerSupabase();
  const weeks = await programWeeks(supabase, programId, workspaceId);
  if (weeks === null) throw new Error('Program not found');
  if (week > weeks) throw new Error('Week is past the end of the program');

  // Last in its cell. The database refuses (42501) a workout that isn't in this workspace's library.
  const { data: last, error: lastError } = await supabase
    .from('program_workouts')
    .select('position')
    .eq('program_id', programId)
    .eq('week', week)
    .eq('day', day)
    .order('position', { ascending: false })
    .limit(1);
  if (lastError) throw new Error(`Could not read the day: ${lastError.message}`);
  const position = Math.min((last[0]?.position ?? -1) + 1, POSITION_MAX);

  // workspace_id is set from the program by a trigger (and the column isn't insertable), so it isn't sent; the
  // generated Insert type still lists it as required.
  const row = { id, program_id: programId, week, day, position, workout_id: workoutId } as Omit<
    Database['public']['Tables']['program_workouts']['Insert'],
    'workspace_id'
  > as Database['public']['Tables']['program_workouts']['Insert'];
  const { error } = await supabase.from('program_workouts').insert(row);
  if (error) throw new Error(`Could not add the workout: ${error.message}`);
}

export async function moveProgramWorkout(input: { id: string; week: number; day: number; position: number }): Promise<void> {
  const { workspaceId } = await requireCoach();
  const { id, week, day, position } = input;
  if (!isUuid(id) || !isInt(day, 1, 7) || !isInt(week, 1, PROGRAM_WEEKS_MAX) || !isInt(position, 0, POSITION_MAX)) {
    throw new Error('Invalid slot');
  }
  const supabase = await createServerSupabase();
  const { data: slot, error: readError } = await supabase
    .from('program_workouts')
    .select('program_id, programs!inner(weeks)')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (readError) throw new Error(`Could not load the slot: ${readError.message}`);
  if (!slot) throw new Error('Slot not found');
  if (week > slot.programs.weeks) throw new Error('Week is past the end of the program');

  const { data, error } = await supabase
    .from('program_workouts')
    .update({ week, day, position })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id');
  if (error) throw new Error(`Could not move the workout: ${error.message}`);
  if (data.length === 0) throw new Error('Slot not found');
}

export async function removeProgramWorkout(id: string): Promise<void> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) throw new Error('Invalid slot');
  const supabase = await createServerSupabase();
  // Removing a slot that's already gone is fine: the coach wanted it gone.
  const { error } = await supabase.from('program_workouts').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) throw new Error(`Could not remove the workout: ${error.message}`);
}
