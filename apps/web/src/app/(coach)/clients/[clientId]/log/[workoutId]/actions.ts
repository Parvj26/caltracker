'use server';

import { revalidatePath } from 'next/cache';
import { LOG_STATUSES, WorkoutLogDoc, codeForMessage, type Database, type LogStatus } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { loadLog } from '@/lib/logs';
import { recomputeAward } from '@/lib/recompute-award';
import { createServerSupabase } from '@/lib/supabase/server';

// The coach's session logging. Every action starts with requireCoach(); the database does the real authorization:
// coach_save_workout_log and take_over_workout_log check the caller coaches the client's workspace and that the
// client is still a client, and refuse a change from anyone but the person logging the workout.

type SaveArgs = Database['public']['Functions']['coach_save_workout_log']['Args'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveOutcome =
  | { ok: true; applied: boolean; revision: number; status: LogStatus; loggedByOther: boolean }
  /** `final`: retrying cannot help (not their client any more, or not allowed). */
  | (ActionFailure & { final: boolean });

function refusal(error: { code?: string; hint?: string; message: string }): SaveOutcome {
  if (error.code === '42501') {
    return { ...fail(error.hint === 'not_a_client' ? 'client_no_longer' : 'session_log_denied', 'action:session.saveSession'), final: true };
  }
  // A later day's workout (the database's own check of the client's today).
  if (error.hint === 'future_workout') return { ...fail('session_future_workout', 'action:session.refusal'), final: true };
  // one_active_log_per_client: the client started another workout on the phone a moment ago.
  if (error.code === '23505') return { ...fail('session_client_started', 'action:session.refusal'), final: true };
  if (error.code === '23514' || error.code === '22023') return { ...fail('log_numbers_invalid', 'action:session.refusal'), final: true };
  return { ...fail('session_save_failed', 'action:session.refusal'), final: false };
}

/** Saves the whole session doc (the same document the phone sends). */
export async function saveSession(input: { clientId: string; doc: WorkoutLogDoc }): Promise<SaveOutcome> {
  await requireCoach();
  if (!UUID.test(input.clientId)) return { ...fail('session_save_failed', 'action:session.saveSession'), final: true };
  const parsed = WorkoutLogDoc.safeParse(input.doc);
  if (!parsed.success) return { ...fail(codeForMessage(parsed.error.issues[0]?.message, 'log_numbers_invalid'), 'action:session.saveSession'), final: true };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('coach_save_workout_log', {
    p_client_id: input.clientId,
    p_doc: parsed.data as unknown as SaveArgs['p_doc'],
  });
  if (error) return refusal(error);
  const r = (data ?? {}) as { applied?: unknown; revision?: unknown; status?: unknown; loggedByOther?: unknown };
  if (typeof r.applied !== 'boolean' || typeof r.revision !== 'number' || !LOG_STATUSES.includes(r.status as LogStatus)) {
    return { ...fail('session_save_failed', 'action:session.saveSession'), final: false };
  }
  return { ok: true, applied: r.applied, revision: r.revision, status: r.status as LogStatus, loggedByOther: r.loggedByOther === true };
}

/** The server's copy of a session, for when a save was refused (another tab, or the client still logging). */
export async function loadSession(logId: string): Promise<WorkoutLogDoc | null> {
  await requireCoach();
  const loaded = await loadLog(await createServerSupabase(), logId);
  return loaded?.log ?? null;
}

/** "Take over": the client was logging this on the phone; from now on only the coach changes it. */
export async function takeOverSession(logId: string): Promise<{ ok: true } | ActionFailure> {
  await requireCoach();
  if (!UUID.test(logId)) return fail('session_save_failed', 'action:session.takeOverSession');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('take_over_workout_log', { p_log_id: logId });
  if (error) {
    if (error.code === '23514') return fail('session_just_finished', 'action:session.takeOverSession');
    if (error.code === '42501') return fail(error.hint === 'not_a_client' ? 'client_no_longer' : 'session_takeover_denied', 'action:session.takeOverSession');
    return fail('session_takeover_failed', 'action:session.takeOverSession');
  }
  revalidatePath('/clients/[clientId]/log/[workoutId]', 'page');
  return { ok: true };
}

/** "Hand back to client": the coach stops logging; the client carries on on their phone. */
export async function handBackSession(logId: string): Promise<{ ok: true } | ActionFailure> {
  await requireCoach();
  if (!UUID.test(logId)) return fail('session_save_failed', 'action:session.handBackSession');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('hand_back_workout_log', { p_log_id: logId });
  if (error) {
    if (error.code === '23514') return fail('session_not_in_progress', 'action:session.handBackSession');
    if (error.code === '42501') return fail(error.hint === 'not_a_client' ? 'client_no_longer' : 'session_not_logging', 'action:session.handBackSession');
    return fail('session_handback_failed', 'action:session.handBackSession');
  }
  revalidatePath('/clients/[clientId]/log/[workoutId]', 'page');
  revalidatePath('/home');
  return { ok: true };
}

/**
 * After the finished session is saved: the client earns stickers, PRs and streaks exactly as when they finish on the
 * phone. award-workout lets a coach ask for a log of their workspace; for a log with no award yet that is the full
 * award (rolls included). A failure is logged and swallowed: the catch-up job awards it within 15 minutes.
 */
export async function awardSession(logId: string): Promise<void> {
  await requireCoach();
  if (!UUID.test(logId)) return;
  const supabase = await createServerSupabase();
  await recomputeAward(supabase, logId);
  revalidatePath('/clients/[clientId]', 'layout');
  revalidatePath('/activity');
  revalidatePath('/home');
}
