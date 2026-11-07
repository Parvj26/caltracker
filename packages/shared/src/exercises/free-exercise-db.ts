import type { Database } from '../database.types';
import { inferTrackingType, type TrackingType } from './tracking';

export type ExerciseInsert = Database['public']['Tables']['exercises']['Insert'];

/** One entry of free-exercise-db `dist/exercises.json`. */
export interface FreeExercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

export const FREE_EXERCISE_DB_IMAGE_PREFIX = 'free-exercise-db/';

const SOURCE_IMAGE_PATH = /^[A-Za-z0-9_()-]+(?:\/[A-Za-z0-9_()-]+)*\.(?:jpe?g|png|gif|webp)$/i;

/**
 * The exercise-images bucket path of a free-exercise-db image (e.g. `Plank/0.jpg`). The import stores every image
 * as a WebP of at most 1600 px plus a 320 px `-thumb.webp` next to it (same rule as chat photos, see thumbPathOf).
 */
export function exerciseImageObjectPath(sourcePath: string): string {
  if (!SOURCE_IMAGE_PATH.test(sourcePath)) throw new Error(`Unexpected exercise image path: ${sourcePath}`);
  return `${FREE_EXERCISE_DB_IMAGE_PREFIX}${sourcePath.replace(/\.[a-z]+$/i, '.webp')}`;
}

export function mapFreeExercise(
  e: FreeExercise,
  overrides: Record<string, TrackingType>,
): ExerciseInsert {
  return {
    source: 'builtin',
    external_id: e.id,
    name: e.name,
    tracking_type: overrides[e.id] ?? inferTrackingType(e),
    primary_muscles: e.primaryMuscles,
    secondary_muscles: e.secondaryMuscles,
    equipment: e.equipment,
    category: e.category,
    instructions: e.instructions,
    image_paths: e.images.map(exerciseImageObjectPath),
  };
}
