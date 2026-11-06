import { useEffect, useState } from 'react';
import { loadCoachProfile, type CoachProfile } from './coach-profile';
import { fetchCoachRecord, signAvatar } from './coach-profile-api';
import { useSession } from './session';

/** The client's coach (photo, name, business, bio). Null until known or when there is no coach; works offline. */
export function useCoachProfile(): CoachProfile | null {
  const userId = useSession().session?.user.id ?? null;
  // Tagged with the user it belongs to, so a different user never sees the previous user's coach.
  const [state, setState] = useState<{ userId: string; profile: CoachProfile | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadCoachProfile(userId, { fetchFresh: fetchCoachRecord, signUrl: signAvatar }).then((p) => {
      if (alive) setState({ userId, profile: p });
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  return state && state.userId === userId ? state.profile : null;
}
