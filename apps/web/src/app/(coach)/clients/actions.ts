'use server';

import { revalidatePath } from 'next/cache';
import {
  CLIENT_CSV_MAX_ROWS,
  InviteInput,
  InvitePlan,
  SendInvitesRequest,
  SendInvitesResponse,
  invitePlanArgs,
  invitePlanError,
  type ErrorCode,
  type IsoDate,
} from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { dateCode, todayError } from '@/lib/assign';
import { sendInChunks } from '@/lib/invite-chunks';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/** Matches the CSV upload limit. */
const MAX_INVITES_PER_BATCH = CLIENT_CSV_MAX_ROWS;

export type SendInvitesOutcome =
  | { ok: true; results: SendInvitesResponse['results'] }
  | ActionFailure;

export async function sendInvites(invites: InviteInput[]): Promise<SendInvitesOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  // The CSV upload allows 200 rows in total; each call to the function is limited, so validate the whole list
  // here and send it in chunks.
  if (invites.length < 1 || invites.length > MAX_INVITES_PER_BATCH) {
    return fail('invite_email_invalid', 'action:clients.sendInvites');
  }
  const checked = invites.map((invite) => SendInvitesRequest.safeParse({ workspaceId, invites: [invite] }));
  if (checked.some((c) => !c.success)) return fail('invite_email_invalid', 'action:clients.sendInvites');

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

export type InviteClientOutcome =
  | ActionFailure
  | {
      ok: true;
      result: SendInvitesResponse['results'][number];
      /** When the link stops working; null when no invite is open (for example they are already a client). */
      expiresAt: string | null;
      /** Set when the invite went out but the program or workouts could not be kept with it. */
      planError: ErrorCode | null;
    };

/** Results where an open invite now exists for the email (so a plan can be kept with it). */
const INVITE_OPEN = new Set(['sent', 'resent', 'with_another_coach']);

/**
 * "Invite a client" with an optional plan: sends the invite (the same path as sendInvites), then keeps the program or
 * workouts with it (set_invite_plan); they go on the client's calendar when they join. The invite stands even if the
 * plan can't be kept: the coach is told to add it from the client's Training page instead.
 */
export async function inviteClient(input: { invite: InviteInput; plan: InvitePlan; today: IsoDate }): Promise<InviteClientOutcome> {
  const { workspaceId } = await requireCoach();
  const invite = InviteInput.safeParse(input.invite);
  if (!invite.success) return fail('invite_email_invalid', 'action:clients.inviteClient');
  const plan = InvitePlan.safeParse(input.plan);
  if (!plan.success) return fail('invite_plan_invalid', 'action:clients.inviteClient');
  if (plan.data.kind !== 'none') {
    const badToday = todayError(input.today);
    if (badToday) return fail(badToday, 'action:clients.inviteClient');
    const badPlan = dateCode(invitePlanError(plan.data, input.today));
    if (badPlan) return fail(badPlan, 'action:clients.inviteClient');
  }

  const sent = await sendInvites([invite.data]);
  if (!sent.ok) return sent;
  const result = sent.results[0];
  if (!result) return fail('invite_send_failed', 'action:clients.inviteClient');
  if (!INVITE_OPEN.has(result.status)) return { ok: true, result, expiresAt: null, planError: null };

  const supabase = await createServerSupabase();
  const open = await supabase
    .from('client_invites')
    .select('id, expires_at')
    .eq('workspace_id', workspaceId)
    .eq('email', invite.data.email)
    .is('accepted_at', null)
    .maybeSingle();
  const row = open.error ? null : open.data;

  // Always set the plan, "Nothing yet" included: re-inviting the same email clears a plan chosen earlier, so a stale
  // one is never applied when they join.
  const kept = row ? await supabase.rpc('set_invite_plan', { p_invite_id: row.id, ...invitePlanArgs(plan.data) }) : null;
  let planError: ErrorCode | null = null;
  if (plan.data.kind !== 'none' && (!kept || kept.error)) {
    planError = plan.data.kind === 'program' ? 'invite_plan_program_failed' : 'invite_plan_workouts_failed';
  }
  revalidatePath('/clients');
  return { ok: true, result, expiresAt: row?.expires_at ?? null, planError };
}

export type SimpleOutcome = { ok: true } | ActionFailure;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Removes a client from the coach's workspace (soft: they move to Past clients). */
export async function removeClient(userId: string): Promise<SimpleOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(userId)) return fail('server_error', 'action:clients.removeClient');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('remove_client', { p_workspace_id: workspaceId, p_user_id: userId });
  revalidatePath('/clients');
  revalidatePath('/clients/[clientId]', 'layout');
  // P0002: already removed (for example in another tab), which is the outcome the coach wanted.
  if (error && error.code !== 'P0002') return fail('client_remove_failed', 'action:clients.removeClient');
  return { ok: true };
}

/** Deletes a pending invite, so the link in the email stops working. Accepted invites are never touched. */
export async function cancelInvite(inviteId: string): Promise<SimpleOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(inviteId)) return fail('server_error', 'action:clients.cancelInvite');
  const supabase = await createServerSupabase();
  // RLS also limits this to the coach's own workspace.
  const { data, error } = await supabase
    .from('client_invites')
    .delete()
    .eq('id', inviteId)
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .select('id');
  if (error) return fail('invite_cancel_failed', 'action:clients.cancelInvite');
  // Nothing deleted: they accepted a moment ago (or it was already cancelled), so the link can't be stopped here.
  // Don't refresh the page yet: the row (and the dialog showing this message) would vanish. The dialog refreshes
  // the page when it is closed.
  if (data.length === 0) return fail('invite_already_used', 'action:clients.cancelInvite');
  revalidatePath('/clients');
  return { ok: true };
}
