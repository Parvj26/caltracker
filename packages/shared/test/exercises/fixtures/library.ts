import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExerciseIndexRow } from '../../../src/exercises/search';
import { inferTrackingType } from '../../../src/exercises/tracking';

/**
 * Names-only copy of the real built-in library (free-exercise-db 876 + 10 CalTracker extras) as imported into the
 * local database: `name|equipment|primary muscles|category`, one per line.
 */
export const LIBRARY: ExerciseIndexRow[] = readFileSync(fileURLToPath(new URL('./library-names.txt', import.meta.url)), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((line, i) => {
    const [name = '', equipment = '', muscles = '', category = ''] = line.split('|');
    const primaryMuscles = muscles ? muscles.split(',') : [];
    return {
      id: `lib-${i}`,
      name,
      primaryMuscles,
      secondaryMuscles: [],
      equipment: equipment || null,
      category: category || null,
      trackingType: inferTrackingType({ category, equipment: equipment || null }),
      source: 'builtin',
      imagePath: null,
    };
  });
