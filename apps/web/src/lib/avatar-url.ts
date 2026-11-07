import { cache } from 'react';
import { thumbPathOf } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/** How long a signed photo link works. Pages are rendered fresh, so a short life is enough. */
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * A short-lived link to the signed-in coach's photo thumbnail, or null when they have none (initials show instead).
 * The bucket is private, so the browser can only load the photo through a link signed here on the server.
 * `?v=` changes with the profile's updated_at, so a replaced photo is never served from the browser cache.
 * Wrapped in cache() so the sidebar and the page sign once per request.
 */
export const coachAvatarUrl = cache(async (): Promise<string | null> => {
  const coach = await requireCoach();
  if (!coach.avatarPath) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(thumbPathOf(coach.avatarPath), SIGNED_URL_SECONDS);
  if (error || !data) return null; // a missing file just means initials
  const version = coach.profileUpdatedAt ? Date.parse(coach.profileUpdatedAt) : 0;
  return `${data.signedUrl}${data.signedUrl.includes('?') ? '&' : '?'}v=${version}`;
});
