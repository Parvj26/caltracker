// The client's display units for the logging screen, kept on the phone so weights read right without signal.
// Shows the saved value at once, then refreshes it from the profile.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { Units } from '@caltracker/shared';
import { within } from './active-log-logic';
import { useSession } from './session';
import { publishUnits, subscribeUnits } from './units-bus';
import { fetchMyUnits, setMyUnits } from './workouts-api';

const key = (userId: string) => `caltracker.units.${userId}`;
/** Poor signal must not hold the logging screen on a spinner: after this, use the saved value or lb. */
const UNITS_WAIT_MS = 4000;

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
      const fetching = fetchMyUnits();
      // A slow answer still lands when it comes; the fallback only stops the wait.
      void fetching
        .then(async (fresh) => {
          if (!alive) return;
          setUnits(fresh);
          await AsyncStorage.setItem(key(userId), fresh);
        })
        .catch(() => undefined);
      const fresh = await within(fetching, UNITS_WAIT_MS);
      if (alive && fresh === null && !known) setUnits('lb');
    })();
    const off = subscribeUnits((who, next) => {
      if (alive && who === userId) setUnits(next);
    });
    return () => {
      alive = false;
      off();
    };
  }, [userId]);

  return units;
}

/** Saves a new kg/lb choice: on the profile, on the phone, and on every screen showing weights. */
export function useSaveUnits(): (units: Units) => Promise<void> {
  const userId = useSession().session?.user.id ?? null;
  return useCallback(
    async (units: Units) => {
      if (!userId) return;
      await setMyUnits(units);
      publishUnits(userId, units);
      await AsyncStorage.setItem(key(userId), units).catch(() => undefined);
    },
    [userId],
  );
}
