import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { loadCoachProfile, type CoachProfile } from './coach-profile';
import { fetchCoachRecord, signAvatar } from './coach-profile-api';
import { useSession } from './session';

/**
 * The client's coach (photo, name, business, bio, join date, goal). Null until known or when there is no coach; works
 * offline. Read again each time the screen using it comes into view, so a goal the coach just changed shows without
 * restarting the app (the photo link is reused, so the image isn't downloaded again).
 */
export function useCoachProfile(): CoachProfile | null {
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  // Tagged with the user it belongs to, so a different user never sees the previous user's coach.
  const [state, setState] = useState<{ userId: string; profile: CoachProfile | null } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let alive = true;
      void loadCoachProfile(userId, { fetchFresh: () => fetchCoachRecord(workspaceId), signUrl: signAvatar }).then((p) => {
        if (alive) setState({ userId, profile: p });
      });
      return () => {
        alive = false;
      };
    }, [userId, workspaceId]),
  );

  return state && state.userId === userId ? state.profile : null;
}
