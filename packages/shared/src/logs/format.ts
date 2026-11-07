// Display text for logs, in the viewer's units. Pure, shared by the phone and the dashboard.
import type { TrackingType } from '../exercises/tracking';
import { KG_PER_LB, formatDistance, formatDuration, formatWeight } from '../units/units';
import type { Units } from '../units/units';
import { formatSetTarget } from '../workouts/targets';
import type { SetType } from '../workouts/schema';
import type { LogExerciseDoc, LogSetTarget } from './schema';
import type { SetValues } from './prefill';

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
    case 'weight_time': {
      const parts: string[] = [];
      if (s.actualWeightKg !== null) parts.push(formatWeight(s.actualWeightKg, units));
      if (s.actualDurationS !== null) parts.push(formatDuration(s.actualDurationS));
      return parts.length > 0 ? parts.join(' · ') : null;
    }
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

/** One set's numbers as text ("135 lb × 8", "8 reps", "0:45", "1.5 mi"), or null when nothing is filled in. */
export function formatResult(v: SetValues, trackingType: TrackingType, units: Units): string | null {
  return resultText(
    { setType: 'normal', actualReps: v.reps, actualWeightKg: v.weightKg, actualDurationS: v.durationS, actualDistanceM: v.distanceM },
    trackingType,
    units,
  );
}

type SetsOf = Pick<LogExerciseDoc, 'sets'>;
type PlanOf = Pick<LogExerciseDoc, 'sets' | 'trackingType'>;

/** "Set 2 of 3", "Warm-up 1 of 2" or "Drop 1 of 2". Sets count working sets only; drops count within their group. */
export function stepName(ex: SetsOf, setIndex: number): string {
  const sets = ex.sets;
  const type = sets[setIndex]?.setType ?? 'normal';
  if (type === 'drop') {
    let start = setIndex;
    while (start > 0 && sets[start - 1]!.setType === 'drop') start -= 1;
    let end = setIndex;
    while (end + 1 < sets.length && sets[end + 1]!.setType === 'drop') end += 1;
    return `Drop ${setIndex - start + 1} of ${end - start + 1}`;
  }
  const same = sets.filter((s) => s.setType === type).length;
  const n = sets.slice(0, setIndex + 1).filter((s) => s.setType === type).length;
  return `${type === 'warmup' ? 'Warm-up' : 'Set'} ${n} of ${same}`;
}

/** The working sets' shared target as text, or null when they differ or there is nothing to say. */
function sharedTarget(ex: PlanOf, units: Units): string | null {
  const working = ex.sets.filter((s) => s.setType === 'normal');
  const first = working[0];
  if (!first) return null;
  const text = formatLogSetTarget(first.target, ex.trackingType, units);
  if (text === '—') return null;
  const same = working.every((s) => formatLogSetTarget(s.target, ex.trackingType, units) === text);
  return same ? text : null;
}

/** "3 × 10 reps · 50 lb" when the working sets share one target, else "3 sets" ("1 set"); null with no working sets. */
export function planSummary(ex: PlanOf, units: Units): string | null {
  const count = ex.sets.filter((s) => s.setType === 'normal').length;
  if (count === 0) return null;
  const shared = sharedTarget(ex, units);
  if (shared !== null) return `${count} × ${shared}`;
  return `${count} ${count === 1 ? 'set' : 'sets'}`;
}

/** The coach's line under a set: the whole plan on a working set when it is uniform, else this set's own target. */
export function coachLine(ex: PlanOf, setIndex: number, units: Units): string | null {
  const set = ex.sets[setIndex];
  if (!set) return null;
  const plan = set.setType === 'normal' && sharedTarget(ex, units) !== null ? planSummary(ex, units) : null;
  if (plan !== null) return `Coach: ${plan}`;
  const own = formatLogSetTarget(set.target, ex.trackingType, units);
  return own === '—' ? null : `Coach: ${own}`;
}
