'use server';

import { revalidatePath } from 'next/cache';
import { CLIENT_CSV_MAX_ROWS, SendInvitesRequest, SendInvitesResponse, type InviteInput } from '@caltracker/shared';
import { sendInChunks } from '@/lib/invite-chunks';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/** Matches the CSV upload limit. */
const MAX_INVITES_PER_BATCH = CLIENT_CSV_MAX_ROWS;

export type SendInvitesOutcome =
  | { ok: true; results: SendInvitesResponse['results'] }
  | { ok: false; error: string };

export async function sendInvites(invites: InviteInput[]): Promise<SendInvitesOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  // The CSV upload allows 200 rows in total; each call to the function is limited, so validate the whole list
  // here and send it in chunks.
  if (invites.length < 1 || invites.length > MAX_INVITES_PER_BATCH) {
    return { ok: false, error: 'Check the name and email, then try again.' };
  }
  const checked = invites.map((invite) => SendInvitesRequest.safeParse({ workspaceId, invites: [invite] }));
  if (checked.some((c) => !c.success)) return { ok: false, error: 'Check the name and email, then try again.' };

  const supabase = await createServerSupabase();
  const results = await sendInChunks(
    checked.map((c) => c.data!.invites[0]!),
    async (chunk) => {
      const body: SendInvitesRequest = { workspaceId, invites: chunk };
      const invoked = await supabase.functions.invoke<unknown>('send-invite', { body });
      if (invoked.error) return null;
      const response = SendInvitesResponse.safeParse(invoked.data);
      return response.success ? response.data.results : null;
    },
  );

  revalidatePath('/clients');
  return { ok: true, results };
}

export type SimpleOutcome = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Removes a client from the coach's workspace (soft: they move to Past clients). */
export async function removeClient(userId: string): Promise<SimpleOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(userId)) return { ok: false, error: 'Something went wrong. Please try again.' };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('remove_client', { p_workspace_id: workspaceId, p_user_id: userId });
  revalidatePath('/clients');
  revalidatePath('/clients/[clientId]', 'layout');
  // P0002: already removed (for example in another tab), which is the outcome the coach wanted.
  if (error && error.code !== 'P0002') return { ok: false, error: "Couldn't remove this client. Please try again." };
  return { ok: true };
}

/** Deletes a pending invite, so the link in the email stops working. Accepted invites are never touched. */
export async function cancelInvite(inviteId: string): Promise<SimpleOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(inviteId)) return { ok: false, error: 'Something went wrong. Please try again.' };
  const supabase = await createServerSupabase();
  // RLS also limits this to the coach's own workspace.
  const { data, error } = await supabase
    .from('client_invites')
    .delete()
    .eq('id', inviteId)
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .select('id');
  if (error) return { ok: false, error: "Couldn't cancel this invite. Please try again." };
  // Nothing deleted: they accepted a moment ago (or it was already cancelled), so the link can't be stopped here.
  // Don't refresh the page yet: the row (and the dialog showing this message) would vanish. The dialog refreshes
  // the page when it is closed.
  if (data.length === 0) return { ok: false, error: 'This invite was already used or cancelled. If they joined, remove them from Clients instead.' };
  revalidatePath('/clients');
  return { ok: true };
}
