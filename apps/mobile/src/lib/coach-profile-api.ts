import { supabase } from './supabase';
import type { CoachRecord } from './coach-profile';

const SIGNED_URL_SECONDS = 60 * 60;

/**
 * The coach's card, or null when the client has no coach. Throws when any part cannot be read, so the copy saved on
 * the phone is kept rather than replaced by a partial one. RLS lets a client read only their own membership row
 * (when they joined) and their own goal, while still a client.
 */
export async function fetchCoachRecord(): Promise<CoachRecord | null> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error('signed out');
  const [profile, member, goal] = await Promise.all([
    supabase.rpc('get_my_coach_profile'),
    supabase.from('workspace_members').select('created_at').eq('user_id', userId).eq('role', 'client').limit(1).maybeSingle(),
    supabase
      .from('client_goals')
      .select('goal, target_date')
      .eq('client_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = profile.error ?? member.error ?? goal.error;
  if (error) throw new Error(error.message);
  const row = profile.data?.[0];
  if (!row) return null;
  return {
    name: row.coach_name,
    businessName: row.business_name,
    bio: row.bio,
    avatarPath: row.avatar_path,
    updatedAt: row.updated_at,
    joinedAt: member.data?.created_at ?? null,
    goal: goal.data ? { goal: goal.data.goal, targetDate: goal.data.target_date } : null,
  };
}

/** The avatars bucket is private: a photo only loads through a link signed for the signed-in client. */
export async function signAvatar(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) throw new Error(error?.message ?? 'no link');
  return data.signedUrl;
}
