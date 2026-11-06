import { supabase } from './supabase';
import type { CoachRecord } from './coach-profile';

const SIGNED_URL_SECONDS = 60 * 60;

/** The coach's card, or null when the client has no coach. Throws when it cannot be read. */
export async function fetchCoachRecord(): Promise<CoachRecord | null> {
  const { data, error } = await supabase.rpc('get_my_coach_profile');
  if (error) throw new Error(error.message);
  const row = data[0];
  if (!row) return null;
  return {
    name: row.coach_name,
    businessName: row.business_name,
    bio: row.bio,
    avatarPath: row.avatar_path,
    updatedAt: row.updated_at,
  };
}

/** The avatars bucket is private: a photo only loads through a link signed for the signed-in client. */
export async function signAvatar(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) throw new Error(error?.message ?? 'no link');
  return data.signedUrl;
}
