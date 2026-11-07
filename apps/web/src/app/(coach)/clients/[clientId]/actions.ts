'use server';

import { revalidatePath } from 'next/cache';
import { AssignProgramInput, IsoDateSchema, ScheduleWorkoutInput, scheduleDateError } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { assignOne, scheduleOne, todayError, type Outcome } from '@/lib/assign';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Every action starts with requireCoach(). The database does the real authorization: assign_program,
// schedule_workout and unassign_program check the caller coaches the workspace and the client is a current client
// (42501 otherwise), and RLS limits workout updates and deletes to the coach's workspace. The workspace id is never
// taken from the browser. Ids for assign and schedule are made in the browser once per dialog, so a double click or
// a retry repeats the same id and the database copies only once.

export type { Outcome } from '@/lib/assign';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const ALREADY_DONE = "You can't move a workout that's already done: it stays on the day it was done. View its log instead.";

const refreshCalendar = () => revalidatePath('/clients/[clientId]', 'layout');

export async function assignProgram(input: AssignProgramInput): Promise<Outcome<{ count: number }>> {
  await requireCoach();
  const parsed = AssignProgramInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a program and a valid start date.' };
  const badToday = todayError(parsed.data.today);
  if (badToday) return { ok: false, error: badToday };
  const outcome = await assignOne(await createServerSupabase(), parsed.data);
  if (outcome.ok) refreshCalendar();
  return outcome;
}

export async function scheduleWorkout(input: ScheduleWorkoutInput): Promise<Outcome> {
  await requireCoach();
  const parsed = ScheduleWorkoutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick a workout and a valid date.' };
  const badToday = todayError(parsed.data.today);
  if (badToday) return { ok: false, error: badToday };
  const outcome = await scheduleOne(await createServerSupabase(), parsed.data);
  if (outcome.ok) refreshCalendar();
  return outcome;
}

/**
 * Moves one calendar workout to today or a later day (`today` is the browser's). A refusal comes back as an outcome
 * so the calendar can show why; other failures throw. Either way the calendar has already moved it and rolls back.
 * A workout with a completed log is refused: it was done on its day, and moving it would move the done mark too.
 */
export async function moveClientWorkout(input: { workoutId: string; date: IsoDate; today: IsoDate }): Promise<Outcome> {
  const { workspaceId } = await requireCoach();
  const date = IsoDateSchema.safeParse(input.date);
  const today = IsoDateSchema.safeParse(input.today);
  if (!isUuid(input.workoutId) || !date.success || !today.success) throw new Error('Invalid move');
  const dateError = todayError(today.data) ?? scheduleDateError(date.data, today.data);
  if (dateError) return { ok: false, error: dateError };
  const supabase = await createServerSupabase();
  const done = await supabase
    .from('workout_logs')
    .select('id', { count: 'exact', head: true })
    .eq('workout_id', input.workoutId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed');
  if (done.error) throw new Error(`Could not check the workout: ${done.error.message}`);
  if ((done.count ?? 0) > 0) return { ok: false, error: ALREADY_DONE };
  const { data, error } = await supabase
    .from('workouts')
    .update({ scheduled_on: date.data })
    .eq('id', input.workoutId)
    .eq('workspace_id', workspaceId)
    .not('client_id', 'is', null)
    .select('id');
  if (error) throw new Error(`Could not move the workout: ${error.message}`);
  if (data.length === 0) throw new Error('Workout not found');
  refreshCalendar();
  return { ok: true };
}

/** Deletes one calendar workout (never a library workout). Throws on failure; one that is already gone is fine. */
export async function deleteClientWorkout(workoutId: string): Promise<void> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(workoutId)) throw new Error('Invalid workout');
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('workouts')
    .delete()
    .eq('id', workoutId)
    .eq('workspace_id', workspaceId)
    .not('client_id', 'is', null);
  if (error) throw new Error(`Could not delete the workout: ${error.message}`);
  refreshCalendar();
}

/**
 * Removes an assignment's workouts on or after `fromDate` (the coach's own today, from the browser). Past ones stay.
 * When nothing is left the database deletes the assignment, so a retry (say, after a lost response) finds it gone.
 * unassign_program answers 42501 both for that and for an assignment this coach can't touch. To tell them apart the
 * assignment is looked up by id alone under RLS (no workspace filter): still visible means it exists and the refusal
 * stands, so it is an error. Not visible means it is gone, or it was never this coach's to see; the dialog only sends
 * ids the page listed, and a made-up id changes nothing and learns nothing, so both count as 0 removed.
 */
export async function unassignProgram(input: { assignmentId: string; fromDate: IsoDate }): Promise<{ removed: number }> {
  await requireCoach();
  const fromDate = IsoDateSchema.safeParse(input.fromDate);
  if (!isUuid(input.assignmentId) || !fromDate.success) throw new Error('Invalid request');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('unassign_program', {
    p_assignment_id: input.assignmentId,
    p_from_date: fromDate.data,
  });
  if (error) {
    if (error.code === '42501') {
      const { data: still, error: readError } = await supabase
        .from('program_assignments')
        .select('id')
        .eq('id', input.assignmentId)
        .maybeSingle();
      if (!readError && !still) {
        refreshCalendar();
        return { removed: 0 };
      }
    }
    throw new Error(`Could not remove the program: ${error.message}`);
  }
  refreshCalendar();
  return { removed: data };
}
