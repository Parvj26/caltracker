'use server';

import { revalidatePath } from 'next/cache';
import { distanceUnitFor, toKg, toMeters, type Database } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Every action starts with requireCoach(). The database does the real authorization: correct_workout_log checks the
// caller coaches the log's workspace, and the comment policies allow only a coach of the workspace, as themselves.

export type Outcome = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = "Couldn't save. Please try again.";
const BODY_MAX = 1000;
const refresh = () => revalidatePath('/clients/[clientId]/logs/[logId]', 'page');

export async function addComment(input: { logId: string; body: string }): Promise<Outcome> {
  await requireCoach();
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) return { ok: false, error: 'Write a comment first.' };
  if (body.length > BODY_MAX) return { ok: false, error: `Keep comments to ${BODY_MAX} characters.` };
  if (!UUID.test(input.logId)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  // workspace_id, client_id and author_id are filled in by the database (a trigger and a default; the grant only
  // allows id, log_id and body), but the generated Insert type lists them as required, hence the cast.
  const row = { log_id: input.logId, body } as unknown as Database['public']['Tables']['workout_log_comments']['Insert'];
  const { error } = await supabase.from('workout_log_comments').insert(row);
  if (error) {
    return { ok: false, error: error.code === '42501' ? "You can't comment on this workout." : GENERIC };
  }
  refresh();
  return { ok: true };
}

export async function deleteComment(id: string): Promise<Outcome> {
  await requireCoach();
  if (!UUID.test(id)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('workout_log_comments').delete().eq('id', id);
  if (error) return { ok: false, error: "Couldn't delete the comment. Please try again." };
  refresh();
  return { ok: true };
}

/**
 * One set's changed fields. Weight is in the coach's units (kg or lb) and distance in km or mi (the coach's
 * distance unit); this action converts them to kg and metres. A field left out keeps its stored value.
 */
export type SetCorrection = {
  id: string;
  actualReps?: number;
  actualWeight?: number;
  actualDurationS?: number;
  actualDistance?: number;
};

const bad = (v: unknown, max: number, whole: boolean) =>
  typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || (whole && !Number.isInteger(v));

export async function correctLog(input: { logId: string; sets: SetCorrection[] }): Promise<Outcome> {
  const { units } = await requireCoach();
  if (!UUID.test(input.logId) || !Array.isArray(input.sets)) return { ok: false, error: GENERIC };
  if (input.sets.length === 0) return { ok: false, error: 'Nothing to change.' };

  const sets: Record<string, unknown>[] = [];
  for (const s of input.sets) {
    if (!UUID.test(s.id)) return { ok: false, error: GENERIC };
    const out: Record<string, unknown> = { id: s.id };
    if (s.actualReps !== undefined) {
      if (bad(s.actualReps, 1000, true)) return { ok: false, error: 'Reps must be a whole number from 0 to 1000.' };
      out.actualReps = s.actualReps;
    }
    if (s.actualWeight !== undefined) {
      const kg = bad(s.actualWeight, 100000, false) ? NaN : toKg(s.actualWeight, units);
      if (!(kg >= 0 && kg <= 1000)) return { ok: false, error: 'Weight is too large.' };
      out.actualWeightKg = kg;
    }
    if (s.actualDurationS !== undefined) {
      if (bad(s.actualDurationS, 86400, true)) return { ok: false, error: 'Time must be under 24 hours.' };
      out.actualDurationS = s.actualDurationS;
    }
    if (s.actualDistance !== undefined) {
      const m = bad(s.actualDistance, 100000, false) ? NaN : toMeters(s.actualDistance, distanceUnitFor(units));
      if (!(m >= 0 && m <= 1_000_000)) return { ok: false, error: 'Distance is too large.' };
      out.actualDistanceM = m;
    }
    sets.push(out);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('correct_workout_log', { p_log_id: input.logId, p_sets: sets as never /* the generated Json type can't take a plain object array */ });
  if (error) {
    if (error.code === '42501') return { ok: false, error: "You can't edit this workout." };
    if (error.code === '23514') {
      return {
        ok: false,
        error: /Nothing to correct/i.test(error.message)
          ? 'Nothing to change.'
          : /finished/i.test(error.message)
            ? 'Only finished workouts can be corrected.'
            : 'Those numbers are not allowed. Check them and try again.',
      };
    }
    return { ok: false, error: GENERIC };
  }
  refresh();
  return { ok: true };
}
