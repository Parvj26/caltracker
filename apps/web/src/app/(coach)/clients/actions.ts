'use server';

import { revalidatePath } from 'next/cache';
import { SendInvitesRequest, SendInvitesResponse, type InviteInput } from '@caltracker/shared';
import { sendInChunks } from '@/lib/invite-chunks';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/** Matches the CSV upload limit. */
const MAX_INVITES_PER_BATCH = 200;

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
