// Display text for logs, in the viewer's units. Pure, shared by the phone and the dashboard.
import type { TrackingType } from '../exercises/tracking';
import { KG_PER_LB, formatDistance, formatDuration, formatWeight } from '../units/units';
import type { Units } from '../units/units';
import { formatSetTarget } from '../workouts/targets';
import type { SetType } from '../workouts/schema';
import type { LogSetTarget } from './schema';

/** A log set's target snapshot, worded exactly like the planned workout ("8–10 reps · 135 lb"). */
export function formatLogSetTarget(target: LogSetTarget, trackingType: TrackingType, units: Units): string {
  return formatSetTarget(
    {
      toFailure: target.toFailure,
      targetRepsMin: target.repsMin,
      targetRepsMax: target.repsMax,
      targetWeightKg: target.weightKg,
      targetDurationS: target.durationS,
      targetDistanceM: target.distanceM,
    },
    trackingType,
    units,
  );
}

export type ResultSet = {
  setType: SetType;
  actualReps: number | null;
  actualWeightKg: number | null;
  actualDurationS: number | null;
  actualDistanceM: number | null;
};

const reps = (n: number) => `${n} ${n === 1 ? 'rep' : 'reps'}`;

function resultText(s: ResultSet, trackingType: TrackingType, units: Units): string | null {
  switch (trackingType) {
    case 'weight_reps':
      if (s.actualWeightKg !== null && s.actualReps !== null) return `${formatWeight(s.actualWeightKg, units)} × ${s.actualReps}`;
      if (s.actualReps !== null) return reps(s.actualReps);
      if (s.actualWeightKg !== null) return formatWeight(s.actualWeightKg, units);
      return null;
    case 'reps':
      return s.actualReps !== null ? reps(s.actualReps) : null;
    case 'time':
      return s.actualDurationS !== null ? formatDuration(s.actualDurationS) : null;
    case 'distance':
      return s.actualDistanceM !== null ? formatDistance(s.actualDistanceM, units) : null;
  }
}

/**
 * "Last time: 135 lb × 8" from the completed sets of the most recent log, using the first set that is not a
 * warm-up. Null when there is nothing worth showing (the line is then hidden).
 */
export function formatLastResult(sets: readonly ResultSet[], trackingType: TrackingType, units: Units): string | null {
  const first = sets.find((s) => s.setType !== 'warmup');
  if (!first) return null;
  const text = resultText(first, trackingType, units);
  return text === null ? null : `Last time: ${text}`;
}

/** A workout's length for people: "53 min", "1 h", "1 h 5 min". Never below 1 min. */
export function formatLogDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * A workout's total volume (logVolumeKg) in the viewer's units, as a whole number with thousands grouped:
 * "8,420 lb lifted". Rounded once, from the unrounded conversion. The grouping is a regex rather than
 * toLocaleString, so the phone (Hermes) and the dashboard (Workers) always print the same text.
 */
export function formatLogVolume(volumeKg: number, units: Units): string {
  const whole = Math.round(units === 'lb' ? volumeKg / KG_PER_LB : volumeKg);
  return `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${units} lifted`;
}
