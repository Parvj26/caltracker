/**
 * weight_time is for loaded carries and holds (Farmer's Walk): a weight held for a time. The last three exist only
 * as a workout exercise's own choice of measurements (see workouts/measurements): a library exercise is always one
 * of LIBRARY_TRACKING_TYPES.
 */
export type TrackingType = 'weight_reps' | 'reps' | 'time' | 'distance' | 'weight_time' | 'weight' | 'reps_time' | 'weight_reps_time';

/** The kinds a library exercise can have (the exercise form and filters offer these). */
export const LIBRARY_TRACKING_TYPES = ['weight_reps', 'reps', 'time', 'distance', 'weight_time'] as const;
export type LibraryTrackingType = (typeof LIBRARY_TRACKING_TYPES)[number];

/** Every type this build knows, library kinds first. */
export const TRACKING_TYPES: readonly TrackingType[] = [...LIBRARY_TRACKING_TYPES, 'weight', 'reps_time', 'weight_reps_time'];

/**
 * What a build reads a tracking type it doesn't know as. A newer server can send a type this build has never heard
 * of (an older phone seeing a type added later), so every read from the server or the phone's own storage goes
 * through toTrackingType, and every lookup by type falls back here too, instead of crashing. Writes stay strict.
 */
export const FALLBACK_TRACKING_TYPE: TrackingType = 'reps';

export function isTrackingType(v: unknown): v is TrackingType {
  return typeof v === 'string' && (TRACKING_TYPES as readonly string[]).includes(v);
}

/** A known tracking type as it is; anything else (an unknown string, null, a number) as FALLBACK_TRACKING_TYPE. */
export function toTrackingType(v: unknown): TrackingType {
  return isTrackingType(v) ? v : FALLBACK_TRACKING_TYPE;
}

/** A library exercise's kind as a library type (the database allows no other); anything else reads as weight and reps. */
export function toLibraryTrackingType(v: unknown): LibraryTrackingType {
  return (LIBRARY_TRACKING_TYPES as readonly unknown[]).includes(v) ? (v as LibraryTrackingType) : 'weight_reps';
}

/** Best-guess tracking type from free-exercise-db metadata; per-exercise overrides win over this. */
export function inferTrackingType(e: { category: string; equipment: string | null }): LibraryTrackingType {
  if (e.category === 'cardio') return 'distance';
  if (e.category === 'stretching') return 'time';
  if (e.equipment === null || e.equipment === 'body only') return 'reps';
  return 'weight_reps';
}
