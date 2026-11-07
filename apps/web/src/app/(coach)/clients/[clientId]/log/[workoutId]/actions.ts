'use server';

import { revalidatePath } from 'next/cache';
import { LOG_STATUSES, WorkoutLogDoc, type Database, type LogStatus } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { loadLog } from '@/lib/logs';
import { recomputeAward } from '@/lib/recompute-award';
import { createServerSupabase } from '@/lib/supabase/server';

// The coach's session logging. Every action starts with requireCoach(); the database does the real authorization:
// coach_save_workout_log and take_over_workout_log check the caller coaches the client's workspace and that the
// client is still a client, and refuse a change from anyone but the person logging the workout.

type SaveArgs = Database['public']['Functions']['coach_save_workout_log']['Args'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = "Couldn't save. Check your connection; it will try again.";

export type SaveOutcome =
  | { ok: true; applied: boolean; revision: number; status: LogStatus; loggedByOther: boolean }
  /** `final`: retrying cannot help (not their client any more, or not allowed). */
  | { ok: false; error: string; final: boolean };

function refusal(error: { code?: string; hint?: string; message: string }): SaveOutcome {
  if (error.code === '42501') {
    return {
      ok: false,
      final: true,
      error: error.hint === 'not_a_client' ? 'This person is no longer your client.' : "You can't log this workout.",
    };
  }
  // one_active_log_per_client: the client started another workout on the phone a moment ago.
  if (error.code === '23505') return { ok: false, final: true, error: 'They just started a workout on their phone. Reload the page.' };
  if (error.code === '23514' || error.code === '22023') return { ok: false, final: true, error: 'Those numbers are not allowed. Check them and try again.' };
  return { ok: false, final: false, error: GENERIC };
}

/** Saves the whole session doc (the same document the phone sends). */
export async function saveSession(input: { clientId: string; doc: WorkoutLogDoc }): Promise<SaveOutcome> {
  await requireCoach();
  if (!UUID.test(input.clientId)) return { ok: false, final: true, error: GENERIC };
  const parsed = WorkoutLogDoc.safeParse(input.doc);
  if (!parsed.success) return { ok: false, final: true, error: parsed.error.issues[0]?.message ?? GENERIC };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('coach_save_workout_log', {
    p_client_id: input.clientId,
    p_doc: parsed.data as unknown as SaveArgs['p_doc'],
  });
  if (error) return refusal(error);
  const r = (data ?? {}) as { applied?: unknown; revision?: unknown; status?: unknown; loggedByOther?: unknown };
  if (typeof r.applied !== 'boolean' || typeof r.revision !== 'number' || !LOG_STATUSES.includes(r.status as LogStatus)) {
    return { ok: false, final: false, error: GENERIC };
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
export async function takeOverSession(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireCoach();
  if (!UUID.test(logId)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('take_over_workout_log', { p_log_id: logId });
  if (error) {
    if (error.code === '23514') return { ok: false, error: 'They just finished it.' };
    if (error.code === '42501') return { ok: false, error: error.hint === 'not_a_client' ? 'This person is no longer your client.' : "You can't take this workout over." };
    return { ok: false, error: "Couldn't take over. Check your connection and try again." };
  }
  revalidatePath('/clients/[clientId]/log/[workoutId]', 'page');
  return { ok: true };
}

/** "Hand back to client": the coach stops logging; the client carries on on their phone. */
export async function handBackSession(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireCoach();
  if (!UUID.test(logId)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('hand_back_workout_log', { p_log_id: logId });
  if (error) {
    if (error.code === '23514') return { ok: false, error: 'This workout is not in progress any more.' };
    if (error.code === '42501') return { ok: false, error: error.hint === 'not_a_client' ? 'This person is no longer your client.' : 'You are not logging this workout any more.' };
    return { ok: false, error: "Couldn't hand it back. Check your connection and try again." };
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
