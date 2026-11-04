'use server';

import { revalidatePath } from 'next/cache';
import { SendInvitesRequest, SendInvitesResponse, type InviteInput } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type SendInvitesOutcome =
  | { ok: true; results: SendInvitesResponse['results'] }
  | { ok: false; error: string };

export async function sendInvites(invites: InviteInput[]): Promise<SendInvitesOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  const request = SendInvitesRequest.safeParse({ workspaceId, invites });
  if (!request.success) return { ok: false, error: 'Check the name and email, then try again.' };

  const supabase = await createServerSupabase();
  const invoked = await supabase.functions.invoke<unknown>('send-invite', { body: request.data });
  const data: unknown = invoked.data;
  if (invoked.error) return { ok: false, error: "Couldn't send the invites. Please try again." };

  const response = SendInvitesResponse.safeParse(data);
  if (!response.success) return { ok: false, error: "Couldn't send the invites. Please try again." };

  revalidatePath('/clients');
  return { ok: true, results: response.data.results };
}
