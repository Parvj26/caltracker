import { FALLBACK_TRACKING_TYPE } from '../exercises/tracking';
import type { TrackingType } from '../exercises/tracking';
import { formatDistance, formatDuration, formatWeight } from '../units/units';
import type { Units } from '../units/units';
import type { WorkoutSetDoc } from './schema';

export const TARGET_FIELDS: Record<TrackingType, ReadonlyArray<'reps' | 'weight' | 'duration' | 'distance'>> = {
  weight_reps: ['reps', 'weight'],
  reps: ['reps'],
  time: ['duration'],
  distance: ['distance'],
  weight_time: ['weight', 'duration'],
  weight: ['weight'],
  reps_time: ['reps', 'duration'],
  weight_reps_time: ['reps', 'weight', 'duration'],
};

export const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  weight_reps: 'weight and reps',
  reps: 'reps only',
  time: 'time',
  distance: 'distance',
  weight_time: 'weight and time',
  weight: 'weight only',
  reps_time: 'reps and time',
  weight_reps_time: 'weight, reps and time',
};

type TargetField = 'reps' | 'weight' | 'duration' | 'distance';

/** The target fields a tracking type uses; an unknown type (from a newer server) gets the fallback's, never undefined. */
export function targetFieldsFor(trackingType: TrackingType): ReadonlyArray<TargetField> {
  return (TARGET_FIELDS as Partial<Record<string, ReadonlyArray<TargetField>>>)[trackingType] ?? TARGET_FIELDS[FALLBACK_TRACKING_TYPE];
}

/**
 * True for a type whose sets have both a weight and reps (weight and reps, or weight, reps and time): the sets that
 * count for volume and lifting PRs.
 */
export function countsWeightTimesReps(trackingType: TrackingType): boolean {
  return trackingType === 'weight_reps' || trackingType === 'weight_reps_time';
}

/** "weight and reps", "reps only", ...; an unknown type reads as the fallback's label. */
export function trackingTypeLabel(trackingType: TrackingType): string {
  return (TRACKING_TYPE_LABELS as Partial<Record<string, string>>)[trackingType] ?? TRACKING_TYPE_LABELS[FALLBACK_TRACKING_TYPE];
}

/** The set with every target its tracking type doesn't use cleared (an unknown type keeps only the fallback's). */
export function fitSetTargets<S extends Pick<WorkoutSetDoc, 'targetRepsMin' | 'targetRepsMax' | 'targetWeightKg' | 'targetDurationS' | 'targetDistanceM'>>(
  trackingType: TrackingType,
  s: S,
): S {
  const allowed = targetFieldsFor(trackingType);
  const keep = <T>(field: TargetField, v: T | null): T | null => (allowed.includes(field) ? v : null);
  return {
    ...s,
    targetRepsMin: keep('reps', s.targetRepsMin),
    targetRepsMax: keep('reps', s.targetRepsMax),
    targetWeightKg: keep('weight', s.targetWeightKg),
    targetDurationS: keep('duration', s.targetDurationS),
    targetDistanceM: keep('distance', s.targetDistanceM),
  };
}

/** Only the target fields are read, so a log set's snapshot can be worded the same way. */
export type SetTargetFields = Pick<
  WorkoutSetDoc,
  'toFailure' | 'targetRepsMin' | 'targetRepsMax' | 'targetWeightKg' | 'targetDurationS' | 'targetDistanceM'
>;

export function formatSetTarget(set: SetTargetFields & Partial<WorkoutSetDoc>, trackingType: TrackingType, units: Units): string {
  if (set.toFailure) {
    // "10 lb × to failure" when the set has a weight to show; otherwise just "To failure".
    const weighted = targetFieldsFor(trackingType).includes('weight') && set.targetWeightKg !== null;
    return weighted ? `${formatWeight(set.targetWeightKg!, units)} × to failure` : 'To failure';
  }
  const fields = targetFieldsFor(trackingType);
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

/**
 * One line for an exercise's sets on the workout preview, e.g. "35 lb × 12, 45 lb × 10, ↓ 25 lb × 8", and how many
 * sets it has. A weighted set reads weight first ("35 lb × 12", or "60 kg × 8–10"); every other set is worded as
 * formatSetTarget words it, so units, time, distance and reps-only tracking read the same as the full rows.
 * Warm-ups are marked "W ", drops "↓ ". `spoken` is the same line for screen readers, with the marks as words
 * ("warm-up 20 lb × 10, drop to failure") and "no target" for a set with none. The count is the warm-up and
 * working sets: a drop continues the set before it, so it is not counted again. No sets: empty text and 0.
 */
export function formatSetsSummary(
  sets: readonly WorkoutSetDoc[],
  trackingType: TrackingType,
  units: Units,
): { text: string; spoken: string; count: number } {
  const text: string[] = [];
  const spoken: string[] = [];
  for (const set of sets) {
    const part = summaryPart(set, trackingType, units);
    const mark = set.setType === 'warmup' ? 'W ' : set.setType === 'drop' ? '↓ ' : '';
    const word = set.setType === 'warmup' ? 'warm-up ' : set.setType === 'drop' ? 'drop ' : '';
    text.push(mark + part);
    const said = part === '—' ? 'no target' : part;
    spoken.push(word ? word + said.replace(/^To failure/, 'to failure') : said);
  }
  return { text: text.join(', '), spoken: spoken.join(', '), count: sets.filter((s) => s.setType !== 'drop').length };
}

function summaryPart(set: WorkoutSetDoc, trackingType: TrackingType, units: Units): string {
  const min = set.targetRepsMin ?? set.targetRepsMax;
  const max = set.targetRepsMax ?? set.targetRepsMin;
  if (trackingType === 'weight_reps' && !set.toFailure && set.targetWeightKg !== null && min !== null && max !== null) {
    return `${formatWeight(set.targetWeightKg, units)} × ${min === max ? min : `${min}–${max}`}`;
  }
  return formatSetTarget(set, trackingType, units);
}
