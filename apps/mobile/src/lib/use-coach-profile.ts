// Who the client is talking to: the coach's name and business name, with a photo slot for when coach profile
// photos exist (none yet, so the screen shows initials). Name from get_my_coach, business from the coach link.
import { useEffect, useState } from 'react';
import { useSession } from './session';
import { fetchMyCoachName } from './workouts-api';

export type CoachProfile = { name: string | null; businessName: string | null; photoUrl: string | null };

export function useCoachProfile(): CoachProfile {
  const { workspace } = useSession();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchMyCoachName().then((n) => alive && setName(n));
    return () => {
      alive = false;
    };
  }, [workspace?.workspaceId]);
  return { name, businessName: workspace?.workspaceName || null, photoUrl: null };
}
