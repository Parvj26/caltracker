'use server';

import { revalidatePath } from 'next/cache';
import { PROGRAM_WEEKS_MAX, ProgramInput, copyName, copyWeek } from '@caltracker/shared';
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

  // Name and description first: if changing the length then fails, the worst left behind is a harmless rename.
  const { error } = await supabase
    .from('programs')
    .update({ name: parsed.data.name, description: parsed.data.description })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) return { ok: false, error: "Couldn't save the name and description. Please try again." };

  // set_program_weeks deletes slots past the new end and changes weeks in one transaction.
  let removedSlots = 0;
  if (current.weeks !== parsed.data.weeks) {
    const { data: removed, error: weeksError } = await supabase.rpc('set_program_weeks', {
      p_program_id: id,
      p_weeks: parsed.data.weeks,
    });
    if (weeksError) return { ok: false, error: "Couldn't change the number of weeks. Please try again." };
    removedSlots = removed;
  }

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
  if (error) {
    // A retry of an add whose first try was saved hits the primary key. If the row with this id is exactly the
    // slot asked for, the add already happened: report success so the grid keeps the chip.
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('program_workouts')
        .select('program_id, week, day, workout_id')
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (
        existing &&
        existing.program_id === programId &&
        existing.week === week &&
        existing.day === day &&
        existing.workout_id === workoutId
      ) {
        return;
      }
    }
    throw new Error(`Could not add the workout: ${error.message}`);
  }
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

export type DuplicateProgramOutcome = { ok: true; id: string } | { ok: false; error: string };

/**
 * Copies a program (details and every workout on its weeks) into a new program named "<name> (copy)" in the coach's
 * workspace. duplicate_program does it in one transaction and refuses a program the caller can't see (another
 * workspace's), so a half-made copy is never left behind.
 */
export async function duplicateProgram(id: string): Promise<DuplicateProgramOutcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return { ok: false, error: "Couldn't find that program." };
  const supabase = await createServerSupabase();
  const { data: program, error: readError } = await supabase
    .from('programs')
    .select('name')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (readError) return { ok: false, error: "Couldn't copy. Please try again." };
  if (!program) return { ok: false, error: "Couldn't find that program. It may have been deleted." };

  const newId = crypto.randomUUID();
  const { error } = await supabase.rpc('duplicate_program', {
    p_new_id: newId,
    p_program_id: id,
    p_name: copyName(program.name),
  });
  if (error) return { ok: false, error: "Couldn't copy. Please try again." };
  revalidatePath('/programs');
  return { ok: true, id: newId };
}

export type CopyWeekOutcome =
  | { ok: true; slots: Array<{ id: string; week: number; day: number; position: number; workoutId: string }> }
  | { ok: false; error: string };

/**
 * Copies week `fromWeek` onto `toWeeks`, replacing what those weeks held (copyWeek in packages/shared decides the
 * new slots, from the slots as saved). replace_program_weeks swaps them in one transaction. Returns the new slots of
 * the target weeks, so the grid can show their saved ids.
 */
export async function copyProgramWeek(input: { programId: string; fromWeek: number; toWeeks: number[] }): Promise<CopyWeekOutcome> {
  const { workspaceId } = await requireCoach();
  const { programId, fromWeek, toWeeks } = input;
  if (
    !isUuid(programId) ||
    !isInt(fromWeek, 1, PROGRAM_WEEKS_MAX) ||
    !Array.isArray(toWeeks) ||
    toWeeks.length === 0 ||
    toWeeks.length > PROGRAM_WEEKS_MAX ||
    !toWeeks.every((w) => isInt(w, 1, PROGRAM_WEEKS_MAX))
  ) {
    return { ok: false, error: "Couldn't copy that week." };
  }
  const supabase = await createServerSupabase();
  const weeks = await programWeeks(supabase, programId, workspaceId);
  if (weeks === null) return { ok: false, error: "Couldn't find that program. It may have been deleted." };
  if (fromWeek > weeks || toWeeks.some((w) => w > weeks)) {
    return { ok: false, error: 'That week is past the end of the program. Reload the page and try again.' };
  }

  const { data: rows, error: readError } = await supabase
    .from('program_workouts')
    .select('id, week, day, position, workout_id')
    .eq('program_id', programId)
    .eq('workspace_id', workspaceId)
    .eq('week', fromWeek);
  if (readError) return { ok: false, error: "Couldn't copy. Please try again." };
  const source = rows.map((r) => ({ id: r.id, week: r.week, day: r.day, position: r.position, workoutId: r.workout_id }));
  const plan = copyWeek(source, { from: fromWeek, to: toWeeks, weeks }, () => crypto.randomUUID());
  if (plan.weeks.length === 0) return { ok: false, error: "Couldn't copy that week." };

  const { error } = await supabase.rpc('replace_program_weeks', {
    p_program_id: programId,
    p_weeks: plan.weeks,
    p_slots: plan.added,
  });
  if (error) return { ok: false, error: "Couldn't copy. Please try again." };
  revalidatePath(`/programs/${programId}`);
  return { ok: true, slots: plan.added };
}
