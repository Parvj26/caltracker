// The client's display units for the logging screen, kept on the phone so weights read right without signal.
// Shows the saved value at once, then refreshes it from the profile.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { Units } from '@caltracker/shared';
import { useSession } from './session';
import { fetchMyUnits } from './workouts-api';

const key = (userId: string) => `caltracker.units.${userId}`;

/** Null until known. New accounts default to lb, so that is the fallback when nothing can be read. */
export function useUnits(): Units | null {
  const userId = useSession().session?.user.id ?? null;
  const [units, setUnits] = useState<Units | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      let known = false;
      try {
        const saved = await AsyncStorage.getItem(key(userId));
        if (alive && (saved === 'kg' || saved === 'lb')) {
          setUnits(saved);
          known = true;
        }
      } catch {
        // fall through to the network
      }
      try {
        const fresh = await fetchMyUnits();
        if (!alive) return;
        setUnits(fresh);
        await AsyncStorage.setItem(key(userId), fresh);
      } catch {
        if (alive && !known) setUnits('lb');
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  return units;
}
