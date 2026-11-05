import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Units } from '@caltracker/shared';
import { createServerSupabase } from '@/lib/supabase/server';

export type CoachContext = { userId: string; workspaceId: string; workspaceName: string; units: Units };

/**
 * Signed-out visitors go to /sign-in. Signed-in users without an owner/staff membership go to
 * /not-a-coach, which shows "This dashboard is for coaches. Clients use the CalTracker app."
 * V1 has one coach membership per user; if there are several, the earliest created wins.
 * Wrapped in cache() so one request queries once.
 */
export const requireCoach = cache(async (): Promise<CoachContext> => {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/sign-in');

  const [{ data, error }, profile] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('workspace_id, workspaces(name)')
      .eq('user_id', auth.user.id)
      .in('role', ['owner', 'staff'])
      .order('created_at', { ascending: true })
      .limit(1),
    supabase.from('profiles').select('units').eq('id', auth.user.id).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load membership: ${error.message}`);
  if (profile.error) throw new Error(`Could not load profile: ${profile.error.message}`);

  const row = data[0];
  if (!row) redirect('/not-a-coach');
  return {
    userId: auth.user.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspaces?.name ?? '',
    units: profile.data?.units === 'lb' ? 'lb' : 'kg',
  };
});
