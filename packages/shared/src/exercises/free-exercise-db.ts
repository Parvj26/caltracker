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
    image_paths: e.images.map((p) => `${FREE_EXERCISE_DB_IMAGE_PREFIX}${p}`),
  };
}
