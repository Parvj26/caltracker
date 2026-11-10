import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createServerSupabase } from '@/lib/supabase/server';
import { roleAtLeast, type AdminRole } from '@/lib/roles';

export type AdminContext = { userId: string; name: string; role: AdminRole };

/** First name for "Signed in as …": from the sign-up metadata, else the start of the email. */
function displayName(user: User): string {
  const meta = user.user_metadata as Record<string, unknown>;
  const first = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
  if (first) return first;
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim().split(/\s+/)[0] : '';
  if (full) return full;
  return (user.email ?? '').split('@')[0] ?? '';
}

/**
 * Who is signed in, once per request. Signed out → /sign-in; not an admin → /auth/denied (signs out, then shows
 * "Not authorised"); password only (aal1) → /mfa. The database checks all of this again on every admin_* call.
 */
const loadAdmin = cache(async (): Promise<AdminContext> => {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/sign-in');

  const me = await supabase.rpc('admin_me');
  if (me.error) throw new Error(`Could not check admin access: ${me.error.message}`);
  const row = me.data[0];
  if (!row) redirect('/auth/denied');

  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel !== 'aal2') redirect('/mfa');

  return { userId: auth.user.id, name: displayName(auth.user), role: row.role };
});

/** The signed-in admin, or a redirect. Anyone below `min` gets "Not authorised". */
export async function requireAdmin(min: AdminRole = 'readonly'): Promise<AdminContext> {
  const admin = await loadAdmin();
  if (!roleAtLeast(admin.role, min)) redirect('/auth/denied');
  return admin;
}
