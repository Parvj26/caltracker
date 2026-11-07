/** weight_time is for loaded carries and holds (Farmer's Walk): a weight held for a time. */
export type TrackingType = 'weight_reps' | 'reps' | 'time' | 'distance' | 'weight_time';

export const TRACKING_TYPES: readonly TrackingType[] = ['weight_reps', 'reps', 'time', 'distance', 'weight_time'];

/** Best-guess tracking type from free-exercise-db metadata; per-exercise overrides win over this. */
export function inferTrackingType(e: { category: string; equipment: string | null }): TrackingType {
  if (e.category === 'cardio') return 'distance';
  if (e.category === 'stretching') return 'time';
  if (e.equipment === null || e.equipment === 'body only') return 'reps';
  return 'weight_reps';
}
