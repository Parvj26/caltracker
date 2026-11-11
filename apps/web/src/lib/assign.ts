import type { SupabaseClient } from '@supabase/supabase-js';
import { codeForMessage, isPlausibleToday, localToday, programStartError, scheduleDateError } from '@caltracker/shared';
import type { Database, ErrorCode, IsoDate } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';

// Server-only helpers behind every "put this on a client's calendar" action: the calendar's own dialogs and the
// library's Assign to several clients. Each call is one database function (schedule_workout or assign_program),
// which checks the caller coaches the workspace and the client is a current client (42501 otherwise) and copies the
// workout(s) in one transaction: all or nothing for that client. Copies go through copy_workout, so Live Sync's
// bookkeeping (planned_on, source_hash) is set the same way whichever screen assigned it.

export type Outcome<T extends object = object> = ({ ok: true } & T) | ActionFailure;

/**
 * Date rules (single workouts today or later, programs from up to 7 days back) are measured from the coach's own
 * today, which only the browser knows. The browser sends it; it must be within a day of UTC's date here, so it can't
 * be moved far to get round the rules.
 */
export const todayError = (today: IsoDate): ErrorCode | null => (isPlausibleToday(today, localToday('UTC')) ? null : 'date_bad_today');

/** The code of a shared date rule's message (each one is in the error-code list). */
export const dateCode = (message: string | null): ErrorCode | null => (message ? codeForMessage(message, 'assign_date_invalid') : null);

/** schedule_workout: one library workout onto one client's day (today or later). */
export async function scheduleOne(
  supabase: SupabaseClient<Database>,
  i: { newId: string; workoutId: string; clientId: string; date: IsoDate; today: IsoDate },
): Promise<Outcome> {
  const dateError = dateCode(scheduleDateError(i.date, i.today));
  if (dateError) return fail(dateError, 'action:assign.scheduleOne');
  const { error } = await supabase.rpc('schedule_workout', {
    p_new_id: i.newId,
    p_workout_id: i.workoutId,
    p_client_id: i.clientId,
    p_date: i.date,
  });
  if (error) {
    if (error.code === '42501') return fail('client_not_current', 'action:assign.scheduleOne');
    if (error.code === '23505') return fail('schedule_conflict', 'action:assign.scheduleOne');
    return fail('schedule_save_failed', 'action:assign.scheduleOne');
  }
  return { ok: true };
}

/** assign_program: a program onto one client's calendar from a start date (up to 7 days back). Counts the copies. */
export async function assignOne(
  supabase: SupabaseClient<Database>,
  i: { assignmentId: string; programId: string; clientId: string; startDate: IsoDate; today: IsoDate },
): Promise<Outcome<{ count: number }>> {
  const dateError = dateCode(programStartError(i.startDate, i.today));
  if (dateError) return fail(dateError, 'action:assign.assignOne');
  const { data: id, error } = await supabase.rpc('assign_program', {
    p_assignment_id: i.assignmentId,
    p_program_id: i.programId,
    p_client_id: i.clientId,
    p_start_date: i.startDate,
  });
  if (error) {
    if (error.code === '42501') return fail('client_not_current', 'action:assign.assignOne');
    if (error.code === '23505') return fail('assign_conflict', 'action:assign.assignOne');
    return fail('assign_save_failed', 'action:assign.assignOne');
  }
  const { count, error: countError } = await supabase
    .from('workouts')
    .select('id', { count: 'exact', head: true })
    .eq('assignment_id', id);
  return { ok: true, count: countError ? 0 : (count ?? 0) };
}

/**
 * copy_client_workout: a client's calendar workout as it is (with the coach's changes) onto one client's day (today
 * or later). The copy is a single customised workout, so Live Sync never touches it.
 */
export async function copyOne(
  supabase: SupabaseClient<Database>,
  i: { newId: string; sourceId: string; clientId: string; date: IsoDate; today: IsoDate },
): Promise<Outcome> {
  const dateError = dateCode(scheduleDateError(i.date, i.today));
  if (dateError) return fail(dateError, 'action:assign.copyOne');
  const { error } = await supabase.rpc('copy_client_workout', {
    p_source: i.sourceId,
    p_new_id: i.newId,
    p_client_id: i.clientId,
    p_date: i.date,
  });
  if (error) {
    if (error.code === '42501') return fail('copy_not_client', 'action:assign.copyOne');
    if (error.code === '23505') return fail('copy_conflict', 'action:assign.copyOne');
    return fail('copy_save_failed', 'action:assign.copyOne');
  }
  return { ok: true };
}
