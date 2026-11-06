import { useEffect, useMemo, useState } from 'react';
import type { ExerciseDetail } from './exercise-detail';
import { exerciseDetailsFor, prefetchExerciseImages } from './exercise-detail-api';
import { useSession } from './session';

/**
 * Details for these exercises, loaded once per set of ids. Starts from whatever the signed-in user's cache already
 * holds in memory, so a second visit paints at once, and fills in as the load finishes. A failed load leaves what
 * is known. Signed out, it is empty.
 */
export function useExerciseDetails(ids: readonly string[]): Record<string, ExerciseDetail> {
  const userId = useSession().session?.user.id ?? null;
  const key = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);
  const known = (): Record<string, ExerciseDetail> => {
    const out: Record<string, ExerciseDetail> = {};
    if (!userId || !key) return out;
    const cache = exerciseDetailsFor(userId);
    for (const id of key.split(',')) {
      const d = cache.peek(id);
      if (d) out[id] = d;
    }
    return out;
  };
  const [details, setDetails] = useState(known);
  useEffect(() => {
    if (!userId || !key) return;
    let alive = true;
    // Reset first: another user's details must not linger for a moment.
    setDetails(known());
    exerciseDetailsFor(userId)
      .load(key.split(','))
      .then((found) => {
        if (!alive) return;
        for (const d of Object.values(found)) prefetchExerciseImages(d.imagePaths);
        setDetails((prev) => ({ ...prev, ...found }));
      })
      .catch(() => undefined); // photos are a nicety: the name alone is fine
    return () => {
      alive = false;
    };
  }, [userId, key]);
  return details;
}
