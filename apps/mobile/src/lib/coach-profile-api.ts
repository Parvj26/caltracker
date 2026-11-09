import { supabase } from './supabase';
import { joinedAtIn, type CoachRecord } from './coach-profile';

const SIGNED_URL_SECONDS = 60 * 60;

/**
 * The coach's card for the workspace the app is signed into (`workspaceId`, the client's one membership that
 * get_my_coach_profile also reads), or null when the client has no coach. Throws when any part cannot be read, so the
 * copy saved on the phone is kept rather than replaced by a partial one. RLS lets a client read only their own
 * membership rows (when they joined) and their own goal, while still a client.
 */
export async function fetchCoachRecord(workspaceId: string | null): Promise<CoachRecord | null> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error('signed out');
  const [profile, member, goal] = await Promise.all([
    supabase.rpc('get_my_coach_profile'),
    // Oldest first (a stable order); joinedAtIn keeps the row of the coach's workspace only.
    supabase.from('workspace_members').select('workspace_id, created_at').eq('user_id', userId).eq('role', 'client').order('created_at'),
    // The goal the coach of this workspace set (none to ask for while the workspace is unknown).
    workspaceId
      ? supabase.from('client_goals').select('goal, target_date').eq('client_id', userId).eq('workspace_id', workspaceId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
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
    joinedAt: joinedAtIn(member.data ?? [], workspaceId),
    goal: goal.data ? { goal: goal.data.goal, targetDate: goal.data.target_date } : null,
  };
}

/** The avatars bucket is private: a photo only loads through a link signed for the signed-in client. */
export async function signAvatar(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) throw new Error(error?.message ?? 'no link');
  return data.signedUrl;
}
