'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';
import { adminErrorMessage, GENERIC_ERROR, UUID, type ActionResult } from '@/lib/actions-shared';
import type { AdminRole } from '@/lib/roles';
import { createServerSupabase } from '@/lib/supabase/server';

const ROLES: readonly AdminRole[] = ['owner', 'support', 'readonly'];

/** Adds an admin, or changes their role, by the email of an existing confirmed account. */
export async function setAdmin(email: string, role: string): Promise<ActionResult> {
  await requireAdmin('owner');
  const trimmed = email.trim();
  if (!trimmed.includes('@')) return { ok: false, error: 'Enter the email of their CalTracker account.' };
  if (!(ROLES as readonly string[]).includes(role)) return { ok: false, error: 'Pick a role.' };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_set_admin', { p_email: trimmed, p_role: role as AdminRole });
  revalidatePath('/admins');
  if (error) return { ok: false, error: adminErrorMessage(error) };
  return { ok: true, message: `${trimmed} is now ${role}` };
}

export async function removeAdmin(userId: string): Promise<ActionResult> {
  await requireAdmin('owner');
  if (!UUID.test(userId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('admin_remove_admin', { p_user_id: userId });
  revalidatePath('/admins');
  if (error) return { ok: false, error: adminErrorMessage(error) };
  return { ok: true, message: 'Admin removed' };
}
