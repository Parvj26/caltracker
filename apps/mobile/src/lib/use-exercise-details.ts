import { useEffect, useMemo, useState } from 'react';
import type { ExerciseDetail } from './exercise-detail';
import { exerciseDetails, prefetchExerciseImages } from './exercise-detail-api';

/**
 * Details for these exercises, loaded once per set of ids. Starts from whatever is already in memory, so a
 * second visit paints at once, and fills in as the load finishes. A failed load leaves what is known.
 */
export function useExerciseDetails(ids: readonly string[]): Record<string, ExerciseDetail> {
  const key = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);
  const [details, setDetails] = useState<Record<string, ExerciseDetail>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const wanted = key.split(',');
    exerciseDetails
      .load(wanted)
      .then((found) => {
        if (!alive) return;
        for (const d of Object.values(found)) prefetchExerciseImages(d.imagePaths);
        setDetails((prev) => ({ ...prev, ...found }));
      })
      .catch(() => undefined); // photos are a nicety: the name alone is fine
    return () => {
      alive = false;
    };
  }, [key]);
  return details;
}
