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

export function formatSetTarget(set: WorkoutSetDoc, trackingType: TrackingType, units: Units): string {
  if (set.toFailure) return 'To failure';
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
