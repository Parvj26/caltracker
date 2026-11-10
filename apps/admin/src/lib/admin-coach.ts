import { AdminCoachResponse, type AdminCoachRequest, type Database } from '@caltracker/shared';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { GENERIC_ERROR, type ActionResult } from './actions-shared';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the Delete coach dialog shows (admin_coach_delete_preview). */
export type DeletePreview = {
  workspace_name: string;
  coach_id: string | null;
  coach_name: string;
  counts: { clients: number; staff: number; programs: number; workouts: number; shared_meals: number; custom_exercises: number };
  delete_account_ids: string[];
  /** '' when nothing blocks the delete, else the reason to show. */
  blocker: string;
};

/** "1 program, 1 workout, 0 shared meals": the library line of the Delete coach dialog. */
export function libraryLine(counts: DeletePreview['counts']): string {
  return [plural(counts.programs, 'program'), plural(counts.workouts, 'workout'), plural(counts.shared_meals, 'shared meal')].join(', ');
}

/** The ✓ line after a delete, with anything that needs a person's attention. */
export function deletedMessage(r: { workspaceName: string; clientsEmailed: number; emailsFailed: number; accountsNotDeleted: number }): string {
  const parts = [`${r.workspaceName} deleted`];
  if (r.clientsEmailed > 0) parts.push(`${plural(r.clientsEmailed, 'client')} emailed`);
  if (r.emailsFailed > 0) parts.push(`${plural(r.emailsFailed, 'email')} couldn't be sent (see the function logs)`);
  if (r.accountsNotDeleted > 0) {
    parts.push(`${plural(r.accountsNotDeleted, 'coach account')} couldn't be removed: ask a developer`);
  }
  return parts.join(' · ');
}

/**
 * Calls the admin-coach Edge Function as the signed-in admin (their JWT), like send-invite. The function checks
 * owner + two-step and writes the audit row. Refusals come back as a sentence to show.
 */
export async function invokeAdminCoach(
  supabase: SupabaseClient<Database>,
  body: AdminCoachRequest,
): Promise<{ ok: true; data: AdminCoachResponse } | { ok: false; error: string }> {
  const invoked = await supabase.functions.invoke<unknown>('admin-coach', { body });
  let payload: unknown = invoked.data;
  if (invoked.error) {
    if (!(invoked.error instanceof FunctionsHttpError)) return { ok: false, error: GENERIC_ERROR };
    const res = invoked.error.context as Response;
    if (res.status === 401 || res.status === 403) return { ok: false, error: "You don't have permission to do that." };
    payload = await res.json().catch(() => null);
  }
  const parsed = AdminCoachResponse.safeParse(payload);
  if (!parsed.success) return { ok: false, error: GENERIC_ERROR };
  if ('error' in parsed.data) return { ok: false, error: parsed.data.message ?? GENERIC_ERROR };
  return { ok: true, data: parsed.data };
}

export type { ActionResult };
