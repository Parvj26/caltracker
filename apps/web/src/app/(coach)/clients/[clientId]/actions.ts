'use server';

import { revalidatePath } from 'next/cache';
import {
  AssignProgramInput,
  IsoDateSchema,
  ScheduleWorkoutInput,
  WorkoutDoc,
  clientCopyName,
  duplicateWorkoutDoc,
  libraryNameTaken,
  scheduleDateError,
} from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { assignOne, dateCode, scheduleOne, todayError, type Outcome } from '@/lib/assign';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadWorkoutDoc } from '@/lib/workouts';
import type { SaveWorkoutOutcome } from '../../workouts/actions';

// Every action starts with requireCoach(). The database does the real authorization: assign_program,
// schedule_workout and unassign_program check the caller coaches the workspace and the client is a current client
// (42501 otherwise), and RLS limits workout updates and deletes to the coach's workspace. The workspace id is never
// taken from the browser. Ids for assign and schedule are made in the browser once per dialog, so a double click or
// a retry repeats the same id and the database copies only once.

export type { Outcome } from '@/lib/assign';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const refreshCalendar = () => revalidatePath('/clients/[clientId]', 'layout');

export async function assignProgram(input: AssignProgramInput): Promise<Outcome<{ count: number }>> {
  await requireCoach();
  const parsed = AssignProgramInput.safeParse(input);
  if (!parsed.success) return fail('assign_input_invalid', 'action:clients.assignProgram');
  const badToday = todayError(parsed.data.today);
  if (badToday) return fail(badToday, 'action:clients.assignProgram');
  const outcome = await assignOne(await createServerSupabase(), parsed.data);
  if (outcome.ok) refreshCalendar();
  return outcome;
}

export async function scheduleWorkout(input: ScheduleWorkoutInput): Promise<Outcome> {
  await requireCoach();
  const parsed = ScheduleWorkoutInput.safeParse(input);
  if (!parsed.success) return fail('schedule_input_invalid', 'action:clients.scheduleWorkout');
  const badToday = todayError(parsed.data.today);
  if (badToday) return fail(badToday, 'action:clients.scheduleWorkout');
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
  const dateError = todayError(today.data) ?? dateCode(scheduleDateError(date.data, today.data));
  if (dateError) return fail(dateError, 'action:clients.moveClientWorkout');
  const supabase = await createServerSupabase();
  const done = await supabase
    .from('workout_logs')
    .select('id', { count: 'exact', head: true })
    .eq('workout_id', input.workoutId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed');
  if (done.error) throw new Error(`Could not check the workout: ${done.error.message}`);
  if ((done.count ?? 0) > 0) return fail('workout_move_done', 'action:clients.moveClientWorkout');
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

/**
 * Whether a calendar workout with this id exists (under RLS, in the coach's workspace). The calendar asks after an add
 * that got no clear answer, so a save that did land is kept instead of being added again.
 */
export async function clientWorkoutExists(workoutId: string): Promise<boolean> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(workoutId)) return false;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('workouts')
    .select('id')
    .eq('id', workoutId)
    .eq('workspace_id', workspaceId)
    .not('client_id', 'is', null)
    .maybeSingle();
  if (error) throw new Error(`Could not check the workout: ${error.message}`);
  return data !== null;
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

const refreshLibrary = () => {
  revalidatePath('/workouts');
  revalidatePath('/clients/[clientId]', 'layout');
};

/**
 * "+ New workout" from a client's "Add a workout" window: a workout built in the editor goes straight onto that
 * client's day (`date`, today or later from the browser's `today`), never into the Library, through
 * create_client_workout. With `alsoLibrary` the coach ticked "Also save to Library": the workout is saved to the
 * Library as usual (save_workout) and put on the day the usual calendar way (schedule_workout, with `newId` made once
 * by the browser), so the calendar copy is linked to it. A retry repeats the same ids, so nothing is saved twice.
 * The id that comes back is the calendar workout's.
 */
export async function createClientWorkout(input: {
  doc: unknown;
  clientId: string;
  date: IsoDate;
  today: IsoDate;
  alsoLibrary: boolean;
  newId: string;
  /** The Library copy's id when ticked (made once per editor, like newId). */
  libraryId?: string;
}): Promise<SaveWorkoutOutcome> {
  const { workspaceId } = await requireCoach();
  const parsed = WorkoutDoc.safeParse(input.doc);
  if (!parsed.success) {
    return {
      ...fail('workout_fields_invalid', 'action:clients.createClientWorkout'),
      issues: parsed.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: i.message,
      })),
    };
  }
  const date = IsoDateSchema.safeParse(input.date);
  const today = IsoDateSchema.safeParse(input.today);
  if (!isUuid(input.clientId) || !isUuid(input.newId) || !date.success || !today.success) {
    return fail('schedule_input_invalid', 'action:clients.createClientWorkout');
  }
  const dateError = todayError(today.data) ?? dateCode(scheduleDateError(date.data, today.data));
  if (dateError) return fail(dateError, 'action:clients.createClientWorkout');

  const supabase = await createServerSupabase();
  if (!input.alsoLibrary) {
    const { error } = await supabase.rpc('create_client_workout', {
      p_workspace_id: workspaceId,
      p_client_id: input.clientId,
      p_date: date.data,
      p_doc: parsed.data,
    });
    if (error) {
      if (error.code === '42501') return fail('client_not_current', 'action:clients.createClientWorkout');
      if (error.code === '23505') return fail('schedule_conflict', 'action:clients.createClientWorkout');
      if (error.code === '23514') return fail('workout_invalid', 'action:clients.createClientWorkout');
      return fail('workout_save_failed', 'action:clients.createClientWorkout');
    }
    refreshCalendar();
    return { ok: true, id: parsed.data.id };
  }

  // The Library copy has its own ids (the calendar one keeps the doc's), so ticking and unticking between retries
  // never makes the two collide; a retry with the box ticked saves the same Library workout again.
  if (!isUuid(input.libraryId)) return fail('schedule_input_invalid', 'action:clients.createClientWorkout');
  const libraryDoc = { ...duplicateWorkoutDoc(parsed.data, () => crypto.randomUUID()), id: input.libraryId, name: parsed.data.name };
  const saved = await supabase.rpc('save_workout', { p_workspace_id: workspaceId, p_doc: libraryDoc });
  if (saved.error) {
    if (saved.error.code === '23514') return fail('workout_invalid', 'action:clients.createClientWorkout');
    if (saved.error.code === '42501') return fail('workout_edit_denied', 'action:clients.createClientWorkout');
    return fail('workout_save_failed', 'action:clients.createClientWorkout');
  }
  refreshLibrary();
  const outcome = await scheduleOne(supabase, {
    newId: input.newId,
    workoutId: saved.data,
    clientId: input.clientId,
    date: date.data,
    today: today.data,
  });
  if (!outcome.ok) return outcome;
  refreshCalendar();
  return { ok: true, id: input.newId };
}

export type SaveToLibraryOutcome =
  | { ok: true; id: string; name: string }
  | (ActionFailure & { suggestion?: string; issues?: { path: (string | number)[]; message: string }[] });

/**
 * "Save to Library" in a calendar workout's ⋯ menu: its plan (blocks, exercises, sets, targets and their cues, never
 * what the client logged, nor the workout's own notes) becomes a new Library workout, with fresh ids. The calendar workout itself doesn't change. `name`
 * is the one asked for (the workout's own name at first); when the Library already has it, nothing is saved and
 * `suggestion` offers "<name> (<first name>, <day>)" for the dialog to ask with.
 */
export async function saveToLibrary(input: { workoutId: string; name?: string }): Promise<SaveToLibraryOutcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(input.workoutId)) return fail('request_invalid', 'action:clients.saveToLibrary');
  const supabase = await createServerSupabase();
  const { data: row, error: rowError } = await supabase
    .from('workouts')
    .select('id, scheduled_on, client_id')
    .eq('id', input.workoutId)
    .eq('workspace_id', workspaceId)
    .not('client_id', 'is', null)
    .maybeSingle();
  if (rowError) return fail('library_save_failed', 'action:clients.saveToLibrary');
  if (!row || !row.scheduled_on) return fail('workout_not_found', 'action:clients.saveToLibrary');
  const loaded = await loadWorkoutDoc(supabase, row.id);
  if (!loaded) return fail('workout_not_found', 'action:clients.saveToLibrary');

  const name = (input.name ?? loaded.doc.name).trim();
  // The workout's own notes are often about this client ("knee still sore"), so they stay on the calendar; each
  // exercise's and set's cues go with the plan.
  const copy = WorkoutDoc.safeParse({ ...duplicateWorkoutDoc(loaded.doc, () => crypto.randomUUID()), name, notes: null });
  if (!copy.success) {
    const nameIssue = copy.error.issues.find((i) => i.path[0] === 'name');
    return nameIssue
      ? { ...fail('workout_fields_invalid', 'action:clients.saveToLibrary'), issues: [{ path: ['name'], message: nameIssue.message }] }
      : fail('workout_invalid', 'action:clients.saveToLibrary');
  }

  const library = await supabase.from('workouts').select('name').eq('workspace_id', workspaceId).is('client_id', null);
  if (library.error) return fail('library_save_failed', 'action:clients.saveToLibrary');
  const names = library.data.map((w) => w.name);
  if (libraryNameTaken(name, names)) {
    const profile = await supabase.from('profiles').select('first_name').eq('id', row.client_id).maybeSingle();
    const firstName = profile.data?.first_name ?? '';
    return { ...fail('library_name_taken', 'action:clients.saveToLibrary'), suggestion: clientCopyName(loaded.doc.name, firstName, row.scheduled_on) };
  }

  // Saving a copy is not the coach choosing measurements again, so what new exercises start with stays as it is.
  const { data, error } = await supabase.rpc('save_workout', { p_workspace_id: workspaceId, p_doc: { ...copy.data, rememberChoices: false } });
  if (error) {
    if (error.code === '23514') return fail('workout_invalid', 'action:clients.saveToLibrary');
    return fail('library_save_failed', 'action:clients.saveToLibrary');
  }
  refreshLibrary();
  return { ok: true, id: data, name };
}
