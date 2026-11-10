import { SendInvitesResponse, type SendInvitesRequest } from '@caltracker/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import type { ActionResult } from './actions-shared';

/**
 * Sends one invite through the send-invite Edge Function as the signed-in admin (their JWT), with the same body the
 * coach website sends. The function checks admin_can_invite and writes the resend_invite audit row itself.
 */
export async function sendInviteAsAdmin(
  supabase: SupabaseClient<Database>,
  invite: { workspaceId: string; email: string; firstName: string; lastName: string },
  sentMessage: string,
): Promise<ActionResult> {
  const firstName = invite.firstName.trim() || invite.email.split('@')[0] || 'there';
  const body: SendInvitesRequest = {
    workspaceId: invite.workspaceId,
    invites: [{ email: invite.email.trim().toLowerCase(), firstName, lastName: invite.lastName.trim() }],
  };
  const invoked = await supabase.functions.invoke<unknown>('send-invite', { body });
  if (invoked.error) return { ok: false, error: "Couldn't send the invite. Please try again." };
  const parsed = SendInvitesResponse.safeParse(invoked.data);
  const result = parsed.success ? parsed.data.results[0] : undefined;
  if (!result) return { ok: false, error: "Couldn't send the invite. Please try again." };
  switch (result.status) {
    case 'sent':
    case 'resent':
      return { ok: true, message: sentMessage };
    case 'already_member':
      return { ok: false, error: 'They are already a client of that coach.' };
    case 'with_another_coach':
      return { ok: true, message: `${sentMessage} (they are still with another coach until they accept).` };
    case 'is_coach':
      return { ok: false, error: 'That email belongs to a coach.' };
    default:
      return { ok: false, error: result.message ?? "Couldn't send the invite. Please try again." };
  }
}
