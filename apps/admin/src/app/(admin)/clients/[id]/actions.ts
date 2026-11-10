'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';
import { adminErrorMessage, GENERIC_ERROR, UUID, type ActionResult } from '@/lib/actions-shared';
import { fromJson, type ClientDetail } from '@/lib/admin-data';
import { sendInviteAsAdmin } from '@/lib/send-invite';
import { createServerSupabase } from '@/lib/supabase/server';

async function loadClient(userId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('admin_client', { p_user_id: userId });
  return { supabase, client: error ? null : fromJson<ClientDetail>(data), error };
}

/** Audit row first, then Supabase's own reset email (the same one "Forgot password?" sends). */
export async function sendPasswordReset(userId: string): Promise<ActionResult> {
  await requireAdmin('support');
  if (!UUID.test(userId)) return { ok: false, error: GENERIC_ERROR };
  const { supabase, client, error } = await loadClient(userId);
  if (!client?.email) return { ok: false, error: adminErrorMessage(error) };
  const logged = await supabase.rpc('admin_log_action', { p_action: 'password_reset', p_target: userId, p_details: {} });
  if (logged.error) return { ok: false, error: adminErrorMessage(logged.error) };
  // A throwaway client with no session, so the request is the plain public one and the admin's cookies stay as they are.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' },
  });
  const reset = await anon.auth.resetPasswordForEmail(client.email);
  if (reset.error) return { ok: false, error: "Couldn't send the reset email. Please try again in a minute." };
  return { ok: true, message: `Password reset email sent to ${client.email}` };
}

export async function sendTestPush(userId: string): Promise<ActionResult> {
  await requireAdmin('support');
  if (!UUID.test(userId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_send_test_push', { p_user_id: userId });
  revalidatePath('/', 'layout');
  if (error) return { ok: false, error: adminErrorMessage(error) };
  return { ok: true, message: 'Test notification queued. It should arrive within a minute.' };
}

/** Remove from the current coach (kept as their past client), then invite into the new coach's workspace. */
export async function moveClient(userId: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin('support');
  const target = formData.get('workspace_id');
  if (!UUID.test(userId) || typeof target !== 'string' || !UUID.test(target)) return { ok: false, error: 'Pick the new coach.' };
  const supabase = await createServerSupabase();
  const coaches = await supabase.rpc('admin_coaches');
  const to = coaches.data?.find((c) => c.workspace_id === target);
  if (!to) return { ok: false, error: 'Pick the new coach.' };

  const removed = await supabase.rpc('admin_remove_client', { p_user_id: userId });
  if (removed.error) return { ok: false, error: adminErrorMessage(removed.error) };
  revalidatePath('/', 'layout');

  const { client } = await loadClient(userId);
  const past = client?.removed;
  if (!past) return { ok: false, error: 'Removed from their coach, but the invite to the new coach could not be sent. Use Restore or try again.' };
  const sent = await sendInviteAsAdmin(
    supabase,
    { workspaceId: target, email: past.email, firstName: past.first_name, lastName: past.last_name },
    `Removed from ${past.workspace_name} and invited to ${to.workspace_name}`,
  );
  if (!sent.ok) return { ok: false, error: `Removed from ${past.workspace_name}, but the invite failed: ${sent.error}` };
  return sent;
}

/** Invite a removed client back to the coach they were removed from. */
export async function restoreClient(userId: string): Promise<ActionResult> {
  await requireAdmin('support');
  if (!UUID.test(userId)) return { ok: false, error: GENERIC_ERROR };
  const { supabase, client, error } = await loadClient(userId);
  if (!client) return { ok: false, error: adminErrorMessage(error) };
  if (!client.removed) return { ok: false, error: 'They are not a removed client.' };
  const r = client.removed;
  const sent = await sendInviteAsAdmin(
    supabase,
    { workspaceId: r.workspace_id, email: r.email, firstName: r.first_name, lastName: r.last_name },
    `Invite sent to rejoin ${r.workspace_name}`,
  );
  revalidatePath('/', 'layout');
  return sent;
}
