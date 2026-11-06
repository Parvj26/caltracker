import type { TrackingType } from '../exercises/tracking';
import { formatDistance, formatDuration, formatWeight } from '../units/units';
import type { Units } from '../units/units';
import type { WorkoutSetDoc } from './schema';

export const TARGET_FIELDS: Record<TrackingType, ReadonlyArray<'reps' | 'weight' | 'duration' | 'distance'>> = {
  weight_reps: ['reps', 'weight'],
  reps: ['reps'],
  time: ['duration'],
  distance: ['distance'],
};

export const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  weight_reps: 'weight and reps',
  reps: 'reps only',
  time: 'time',
  distance: 'distance',
};

/** Only the target fields are read, so a log set's snapshot can be worded the same way. */
export type SetTargetFields = Pick<
  WorkoutSetDoc,
  'toFailure' | 'targetRepsMin' | 'targetRepsMax' | 'targetWeightKg' | 'targetDurationS' | 'targetDistanceM'
>;

export function formatSetTarget(set: SetTargetFields & Partial<WorkoutSetDoc>, trackingType: TrackingType, units: Units): string {
  if (set.toFailure) {
    // "10 lb × to failure" when the set has a weight to show; otherwise just "To failure".
    const weighted = TARGET_FIELDS[trackingType].includes('weight') && set.targetWeightKg !== null;
    return weighted ? `${formatWeight(set.targetWeightKg!, units)} × to failure` : 'To failure';
  }
  const fields = TARGET_FIELDS[trackingType];
  const parts: string[] = [];
  if (fields.includes('reps')) {
    const min = set.targetRepsMin ?? set.targetRepsMax;
    const max = set.targetRepsMax ?? set.targetRepsMin;
    if (min !== null && max !== null) parts.push(min === max ? `${min} reps` : `${min}–${max} reps`);
  }
  if (fields.includes('weight') && set.targetWeightKg !== null) parts.push(formatWeight(set.targetWeightKg, units));
  if (fields.includes('duration') && set.targetDurationS !== null) parts.push(formatDuration(set.targetDurationS));
  if (fields.includes('distance') && set.targetDistanceM !== null) {
    parts.push(formatDistance(set.targetDistanceM, units));
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function formatRest(seconds: number): string {
  return seconds > 0 ? `Rest ${formatDuration(seconds)}` : '';
}
