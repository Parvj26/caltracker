import type { TrackingType } from '../exercises/tracking';
import { formatClock, formatDistance, formatWeight } from '../units/units';
import type { Units } from '../units/units';
import { stepReps, stepWeight } from './collapsed';
import type { WorkoutSetDoc } from './schema';
import { singleReps } from './set-kinds';
import { targetFieldsFor } from './targets';

/**
 * The phone builder's set editor (a bottom sheet): each set is one line ("12 × 10 kg · rest 1:30"); tapping it opens
 * big boxes with − / + that start from the set before, quick rep chips, rest, set type and "Apply to all sets".
 */

/** The quick rep chips under the boxes. */
export const QUICK_REPS = [8, 10, 12, 15] as const;
/** The rest choices, in seconds (a box takes any other value). */
export const REST_PRESETS = [60, 90, 120, 180] as const;
/** What + on an empty reps box gives when no other set has reps to start from. */
export const DEFAULT_REPS = 10;

type Field = 'reps' | 'weight' | 'duration' | 'distance';

/**
 * One set's line: `values` "12 × 10 kg" (reps-only "12 reps", time "0:45", distance "400 m", weight and time
 * "10 kg · 0:30"), or null when nothing is filled in ("Not filled yet"); `rest` "rest 1:30", or "no rest" for a
 * drop, a zero rest or a superset exercise that runs straight into the next one. A set to failure with no rep count
 * reads "max". Weights and distances in the coach's units.
 */
export function setLineParts(
  set: WorkoutSetDoc,
  trackingType: TrackingType,
  units: Units,
  opts: { showsRest: boolean },
): { values: string | null; rest: string } {
  const fields = targetFieldsFor(trackingType);
  const reps = singleReps(set.targetRepsMin, set.targetRepsMax);
  const repsText = reps !== null ? String(reps) : set.toFailure ? 'max' : null;
  const weight = fields.includes('weight') && set.targetWeightKg !== null ? formatWeight(set.targetWeightKg, units) : null;
  const parts: string[] = [];
  if (fields.includes('reps') && repsText !== null) parts.push(weight ? `${repsText} × ${weight}` : `${repsText} reps`);
  else if (weight) parts.push(weight);
  if (fields.includes('duration') && set.targetDurationS !== null) parts.push(formatClock(set.targetDurationS));
  if (fields.includes('distance') && set.targetDistanceM !== null) parts.push(formatDistance(set.targetDistanceM, units));
  const rest = opts.showsRest && set.setType !== 'drop' && set.restSeconds > 0 ? `rest ${formatClock(set.restSeconds)}` : 'no rest';
  return { values: parts.length > 0 ? parts.join(' · ') : null, rest };
}

function valueOf(set: WorkoutSetDoc, field: Field): number | null {
  switch (field) {
    case 'reps':
      return singleReps(set.targetRepsMin, set.targetRepsMax);
    case 'weight':
      return set.targetWeightKg;
    case 'duration':
      return set.targetDurationS;
    case 'distance':
      return set.targetDistanceM;
  }
}

/** The nearest set before `index` with this value filled in, else the nearest after it; null when none has it. */
function nearestWith(sets: readonly WorkoutSetDoc[], index: number, field: Field): number | null {
  for (let i = index - 1; i >= 0; i--) if (valueOf(sets[i]!, field) !== null) return i;
  for (let i = index + 1; i < sets.length; i++) if (valueOf(sets[i]!, field) !== null) return i;
  return null;
}

/**
 * The set an empty box's − / + would start from (the nearest earlier set with any of these values, else a later
 * one), for the sheet's "from set 1". Null when the set already has its values, or no other set has any.
 */
export function stepSource(sets: readonly WorkoutSetDoc[], index: number, fields: readonly Field[]): number | null {
  const set = sets[index];
  if (!set || fields.some((f) => valueOf(set, f) !== null)) return null;
  const found = fields.map((f) => nearestWith(sets, index, f)).filter((i): i is number => i !== null);
  if (found.length === 0) return null;
  const before = found.filter((i) => i < index);
  return before.length > 0 ? Math.max(...before) : Math.min(...found);
}

/**
 * − / + on a set's reps. A filled box steps by one (stepReps). An empty box takes the reps of the nearest set that has
 * some (the one before, else after), whichever button: the coach then steps from there, not from 1. With no set to
 * copy, + gives 10 and − leaves it empty.
 */
export function stepRepsFrom(sets: readonly WorkoutSetDoc[], index: number, dir: 1 | -1): number | null {
  const current = valueOf(sets[index]!, 'reps');
  if (current !== null) return stepReps(current, dir);
  const from = nearestWith(sets, index, 'reps');
  if (from !== null) return valueOf(sets[from]!, 'reps');
  return dir === 1 ? DEFAULT_REPS : null;
}

/**
 * − / + on a set's weight, in kilograms as the doc stores them. A filled box steps to the next plate in the coach's
 * units (stepWeight). An empty box takes the weight of the nearest set that has one; with none, + gives one step
 * (2.5 kg or 5 lb) and − leaves it empty.
 */
export function stepWeightFrom(sets: readonly WorkoutSetDoc[], index: number, dir: 1 | -1, units: Units): number | null {
  const current = sets[index]!.targetWeightKg;
  if (current !== null) return stepWeight(current, dir, units);
  const from = nearestWith(sets, index, 'weight');
  if (from !== null) return sets[from]!.targetWeightKg;
  return stepWeight(null, dir, units);
}

export type SetValuesPatch = Partial<
  Pick<WorkoutSetDoc, 'targetRepsMin' | 'targetRepsMax' | 'targetWeightKg' | 'targetDurationS' | 'targetDistanceM' | 'restSeconds'>
>;

/**
 * "Apply to all N sets": the changes that give every other set of the exercise the targets of set `sourceIndex`
 * (reps, weight, time, distance) and its rest. Each set keeps its own type (warm-up, drop…). The rest is copied only
 * from a set that has one of its own onto sets that do (not drops, nor superset exercises that run straight on:
 * `restShown`). Sets that already match get no change.
 */
export function applyToAllPatches(
  sets: readonly WorkoutSetDoc[],
  sourceIndex: number,
  restShown: readonly boolean[],
): Array<{ id: string; patch: SetValuesPatch }> {
  const src = sets[sourceIndex];
  if (!src) return [];
  const hasRest = (i: number) => restShown[i] === true && sets[i]!.setType !== 'drop';
  const copyRest = hasRest(sourceIndex);
  const out: Array<{ id: string; patch: SetValuesPatch }> = [];
  sets.forEach((s, i) => {
    if (i === sourceIndex) return;
    const patch: SetValuesPatch = {
      targetRepsMin: src.targetRepsMin,
      targetRepsMax: src.targetRepsMax,
      targetWeightKg: src.targetWeightKg,
      targetDurationS: src.targetDurationS,
      targetDistanceM: src.targetDistanceM,
    };
    if (copyRest && hasRest(i)) patch.restSeconds = src.restSeconds;
    const differs = (Object.keys(patch) as Array<keyof SetValuesPatch>).some((k) => s[k] !== patch[k]);
    if (differs) out.push({ id: s.id, patch });
  });
  return out;
}
