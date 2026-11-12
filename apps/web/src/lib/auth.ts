import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Units } from '@caltracker/shared';
import { createServerSupabase } from '@/lib/supabase/server';

export type CoachContext = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  workspaceId: string;
  workspaceName: string;
  units: Units;
  bio: string;
  /** Storage path in the avatars bucket (`{userId}/avatar.webp`), or null when there is no photo. */
  avatarPath: string | null;
  /** profiles.updated_at, used to bust the browser cache of a replaced photo. */
  profileUpdatedAt: string | null;
};

/**
 * Signed-out visitors go to /sign-in. Signed-in users without an owner/staff membership go to
 * /not-a-coach, which shows "This dashboard is for coaches. Clients use the CalTracker app."
 * V1 has one coach membership per user; if there are several, the earliest created wins.
 * Wrapped in cache() so one request (layout, page and tab title) checks and queries once.
 */
export const requireCoach = cache(async (): Promise<CoachContext> => {
  const supabase = await createServerSupabase();
  // The token's signature is verified locally (getClaims, with the project's public signing key), not with a round
  // trip to Supabase Auth: the proxy has already refreshed the session, and every query below is still checked by
  // the database's row-level security with this same token.
  const { data: auth } = await supabase.auth.getClaims();
  const user = auth?.claims;
  if (!user?.sub) redirect('/sign-in');

  const [{ data, error }, profile] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('workspace_id, workspaces(name)')
      .eq('user_id', user.sub)
      .in('role', ['owner', 'staff'])
      .order('created_at', { ascending: true })
      .limit(1),
    supabase.from('profiles').select('first_name, last_name, units, bio, avatar_path, updated_at').eq('id', user.sub).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load membership: ${error.message}`);
  if (profile.error) throw new Error(`Could not load profile: ${profile.error.message}`);

  const row = data[0];
  if (!row) redirect('/not-a-coach');
  return {
    userId: user.sub,
    email: user.email ?? '',
    firstName: profile.data?.first_name ?? '',
    lastName: profile.data?.last_name ?? '',
    workspaceId: row.workspace_id,
    workspaceName: row.workspaces?.name ?? '',
    units: profile.data?.units === 'kg' ? 'kg' : 'lb',
    bio: profile.data?.bio ?? '',
    avatarPath: profile.data?.avatar_path ?? null,
    profileUpdatedAt: profile.data?.updated_at ?? null,
  };
});
