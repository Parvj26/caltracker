'use server';

import { revalidatePath } from 'next/cache';
import { AdminCoachRequest } from '@caltracker/shared';
import { requireAdmin } from '@/lib/admin';
import { adminErrorMessage, GENERIC_ERROR, UUID, type ActionResult } from '@/lib/actions-shared';
import { deletedMessage, invokeAdminCoach, type DeletePreview } from '@/lib/admin-coach';
import { createServerSupabase } from '@/lib/supabase/server';

/** Add coach: a new account (they get a set-password email), their workspace and the owner membership. */
export async function addCoach(input: {
  firstName: string;
  lastName: string;
  email: string;
  workspaceName: string;
}): Promise<ActionResult> {
  await requireAdmin('owner');
  const parsed = AdminCoachRequest.safeParse({ action: 'create', ...input });
  if (!parsed.success || parsed.data.action !== 'create') {
    const field = parsed.success ? null : parsed.error.issues[0]?.path[0];
    if (field === 'email') return { ok: false, error: 'Enter a valid email.' };
    if (field === 'firstName') return { ok: false, error: 'Enter their first name.' };
    if (field === 'workspaceName') return { ok: false, error: 'Enter a workspace name (up to 80 characters).' };
    return { ok: false, error: 'Check the fields and try again.' };
  }
  const supabase = await createServerSupabase();
  const result = await invokeAdminCoach(supabase, parsed.data);
  revalidatePath('/coaches');
  if (!result.ok) return result;
  const name = `${parsed.data.firstName} ${parsed.data.lastName}`.trim();
  return { ok: true, message: `${name} added. They got an email to set a password.` };
}

export async function loadDeletePreview(workspaceId: string): Promise<{ ok: true; preview: DeletePreview } | { ok: false; error: string }> {
  await requireAdmin('owner');
  if (!UUID.test(workspaceId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('admin_coach_delete_preview', { p_workspace_id: workspaceId });
  if (error) return { ok: false, error: adminErrorMessage(error) };
  return { ok: true, preview: data as unknown as DeletePreview };
}

/** Delete coach (decision A): the workspace and everything in it. Clients keep their accounts and get an email. */
export async function deleteCoach(workspaceId: string, confirmName: string): Promise<ActionResult> {
  await requireAdmin('owner');
  if (!UUID.test(workspaceId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createServerSupabase();
  const result = await invokeAdminCoach(supabase, { action: 'delete', workspaceId, confirmName });
  revalidatePath('/coaches');
  if (!result.ok) return result;
  if (!('deleted' in result.data)) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, message: deletedMessage(result.data) };
}
