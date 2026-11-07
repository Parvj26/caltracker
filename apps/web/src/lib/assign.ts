import type { SupabaseClient } from '@supabase/supabase-js';
import { BAD_TODAY_ERROR, isPlausibleToday, localToday, programStartError, scheduleDateError } from '@caltracker/shared';
import type { Database, IsoDate } from '@caltracker/shared';

// Server-only helpers behind every "put this on a client's calendar" action: the calendar's own dialogs and the
// library's Assign to several clients. Each call is one database function (schedule_workout or assign_program),
// which checks the caller coaches the workspace and the client is a current client (42501 otherwise) and copies the
// workout(s) in one transaction: all or nothing for that client. Copies go through copy_workout, so Live Sync's
// bookkeeping (planned_on, source_hash) is set the same way whichever screen assigned it.

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export const GENERIC = "Couldn't save. Please try again.";
export const NOT_A_CLIENT = "You can't add workouts for this client. They may no longer be your client.";

/**
 * Date rules (single workouts today or later, programs from up to 7 days back) are measured from the coach's own
 * today, which only the browser knows. The browser sends it; it must be within a day of UTC's date here, so it can't
 * be moved far to get round the rules.
 */
export const todayError = (today: IsoDate) => (isPlausibleToday(today, localToday('UTC')) ? null : BAD_TODAY_ERROR);

/** schedule_workout: one library workout onto one client's day (today or later). */
export async function scheduleOne(
  supabase: SupabaseClient<Database>,
  i: { newId: string; workoutId: string; clientId: string; date: IsoDate; today: IsoDate },
): Promise<Outcome> {
  const dateError = scheduleDateError(i.date, i.today);
  if (dateError) return { ok: false, error: dateError };
  const { error } = await supabase.rpc('schedule_workout', {
    p_new_id: i.newId,
    p_workout_id: i.workoutId,
    p_client_id: i.clientId,
    p_date: i.date,
  });
  if (error) {
    if (error.code === '42501') return { ok: false, error: NOT_A_CLIENT };
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'This add was already sent with a different workout or day. Close this, check the calendar, then add again if needed.',
      };
    }
    return { ok: false, error: GENERIC };
  }
  return { ok: true };
}

/** assign_program: a program onto one client's calendar from a start date (up to 7 days back). Counts the copies. */
export async function assignOne(
  supabase: SupabaseClient<Database>,
  i: { assignmentId: string; programId: string; clientId: string; startDate: IsoDate; today: IsoDate },
): Promise<Outcome<{ count: number }>> {
  const dateError = programStartError(i.startDate, i.today);
  if (dateError) return { ok: false, error: dateError };
  const { data: id, error } = await supabase.rpc('assign_program', {
    p_assignment_id: i.assignmentId,
    p_program_id: i.programId,
    p_client_id: i.clientId,
    p_start_date: i.startDate,
  });
  if (error) {
    if (error.code === '42501') return { ok: false, error: NOT_A_CLIENT };
    if (error.code === '23505') {
      return {
        ok: false,
        error:
          'Assign was already sent with a different program or start date. Close this, check the calendar, then assign again if needed.',
      };
    }
    return { ok: false, error: GENERIC };
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
  const dateError = scheduleDateError(i.date, i.today);
  if (dateError) return { ok: false, error: dateError };
  const { error } = await supabase.rpc('copy_client_workout', {
    p_source: i.sourceId,
    p_new_id: i.newId,
    p_client_id: i.clientId,
    p_date: i.date,
  });
  if (error) {
    if (error.code === '42501') return { ok: false, error: "You can't copy to this client. They may no longer be your client." };
    if (error.code === '23505') {
      return { ok: false, error: 'This copy was already sent for a different day. Close this, check the calendar, then copy again if needed.' };
    }
    return { ok: false, error: GENERIC };
  }
  return { ok: true };
}
