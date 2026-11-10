'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';
import { adminErrorMessage, GENERIC_ERROR, UUID, type ActionResult } from '@/lib/actions-shared';
import { sendInviteAsAdmin } from '@/lib/send-invite';
import { createServerSupabase } from '@/lib/supabase/server';

/** Resend an invite that hasn't been accepted: a new link with a fresh expiry, as the coach's Resend does. */
export async function resendInvite(inviteId: string): Promise<ActionResult> {
  await requireAdmin('support');
  if (!UUID.test(inviteId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createServerSupabase();
  const log = await supabase.rpc('admin_invite_log', { p_limit: 1000 });
  if (log.error) return { ok: false, error: adminErrorMessage(log.error) };
  const invite = log.data.find((i) => i.id === inviteId);
  if (!invite) return { ok: false, error: 'That invite no longer exists.' };
  if (invite.status === 'accepted') return { ok: false, error: 'That invite was already accepted.' };
  const result = await sendInviteAsAdmin(
    supabase,
    { workspaceId: invite.workspace_id, email: invite.email, firstName: invite.first_name ?? '', lastName: invite.last_name ?? '' },
    `Invite sent to ${invite.email}`,
  );
  revalidatePath('/', 'layout');
  return result;
}

/** Delete an invite that hasn't been accepted, so its link stops working. */
export async function cancelInvite(inviteId: string): Promise<ActionResult> {
  await requireAdmin('support');
  if (!UUID.test(inviteId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_cancel_invite', { p_invite_id: inviteId });
  revalidatePath('/', 'layout');
  if (error) return { ok: false, error: adminErrorMessage(error) };
  return { ok: true, message: 'Invite cancelled' };
}
