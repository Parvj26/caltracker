import { useEffect, useState } from 'react';
import { loadCoachProfile, type CoachProfile } from './coach-profile';
import { fetchCoachRecord, signAvatar } from './coach-profile-api';
import { useSession } from './session';

/** The client's coach (photo, name, business, bio). Null until known or when there is no coach; works offline. */
export function useCoachProfile(): CoachProfile | null {
  const userId = useSession().session?.user.id ?? null;
  const [profile, setProfile] = useState<CoachProfile | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadCoachProfile(userId, { fetchFresh: fetchCoachRecord, signUrl: signAvatar }).then((p) => {
      if (alive) setProfile(p);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  return profile;
}
