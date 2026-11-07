import { targetFieldsFor } from '../workouts/targets';
import type { ResultSet } from './format';
import type { ActualPatch } from './ops';
import type { LogExerciseDoc, LogSetDoc } from './schema';

export type SetValues = {
  reps: number | null;
  weightKg: number | null;
  durationS: number | null;
  distanceM: number | null;
};

export const EMPTY_VALUES: SetValues = { reps: null, weightKg: null, durationS: null, distanceM: null };

/** The matching set from last time: nth set of the same type, else the last of that type, else null. */
export function lastTimeFor(
  sets: readonly LogSetDoc[],
  setIndex: number,
  lastTime: readonly ResultSet[],
): ResultSet | null {
  const set = sets[setIndex];
  if (!set) return null;
  const nth = sets.slice(0, setIndex).filter((s) => s.setType === set.setType).length;
  const sameType = lastTime.filter((r) => r.setType === set.setType);
  return sameType[nth] ?? sameType[sameType.length - 1] ?? null;
}

type Field = keyof SetValues;
const FIELDS: readonly Field[] = ['reps', 'weightKg', 'durationS', 'distanceM'];
const TRACK_KEY: Record<Field, 'reps' | 'weight' | 'duration' | 'distance'> = {
  reps: 'reps',
  weightKg: 'weight',
  durationS: 'duration',
  distanceM: 'distance',
};

function actualOf(s: LogSetDoc, f: Field): number | null {
  switch (f) {
    case 'reps':
      return s.actualReps;
    case 'weightKg':
      return s.actualWeightKg;
    case 'durationS':
      return s.actualDurationS;
    case 'distanceM':
      return s.actualDistanceM;
  }
}

function targetOf(s: LogSetDoc, f: Field): number | null {
  switch (f) {
    case 'reps':
      return s.target.repsMax ?? s.target.repsMin;
    case 'weightKg':
      return s.target.weightKg;
    case 'durationS':
      return s.target.durationS;
    case 'distanceM':
      return s.target.distanceM;
  }
}

function lastOf(r: ResultSet | null, f: Field): number | null {
  if (!r) return null;
  switch (f) {
    case 'reps':
      return r.actualReps;
    case 'weightKg':
      return r.actualWeightKg;
    case 'durationS':
      return r.actualDurationS;
    case 'distanceM':
      return r.actualDistanceM;
  }
}

function resolveField(sets: readonly LogSetDoc[], index: number, f: Field, lastTime: readonly ResultSet[]): number | null {
  const set = sets[index]!;
  // 1. What the client already entered on this set.
  const own = actualOf(set, f);
  if (own !== null) return own;

  const earlier = sets.slice(0, index);
  const nearestSame = (pred: (s: LogSetDoc) => boolean) => {
    for (let i = earlier.length - 1; i >= 0; i--) if (pred(earlier[i]!)) return earlier[i]!;
    return null;
  };
  const coach = targetOf(set, f);

  if (f === 'weightKg') {
    if (set.setType === 'drop') {
      // 3. The coach's drop weight, else the step above (main set or previous drop).
      if (coach !== null) return coach;
      if (index > 0 && sets[index - 1]!.setType !== 'warmup') {
        const above = resolveField(sets, index - 1, f, lastTime);
        if (above !== null) return above;
      }
    } else {
      // 2. A change the client made carries forward, unless the coach planned a different weight here.
      const base = nearestSame((s) => s.setType === set.setType && actualOf(s, f) !== null);
      if (base && (coach === null || coach === targetOf(base, f))) return actualOf(base, f);
    }
  }

  // 4. The coach's number.
  if (coach !== null) return coach;
  // 5. The client's own numbers from the nearest earlier set of the same type.
  const sibling = nearestSame((s) => s.setType === set.setType && actualOf(s, f) !== null);
  if (sibling) return actualOf(sibling, f);
  // 6. Last time, 7. empty.
  return lastOf(lastTimeFor(sets, index, lastTime), f);
}

/** Spec "Pre-fill" rules 1–7, per field tracked by ex.trackingType; untracked fields are null. Unknown setId → EMPTY_VALUES. */
export function resolveSetValues(
  ex: Pick<LogExerciseDoc, 'sets' | 'trackingType'>,
  setId: string,
  lastTime: readonly ResultSet[],
): SetValues {
  const index = ex.sets.findIndex((s) => s.id === setId);
  if (index < 0) return { ...EMPTY_VALUES };
  const tracked = targetFieldsFor(ex.trackingType);
  const out: SetValues = { ...EMPTY_VALUES };
  for (const f of FIELDS) {
    if (tracked.includes(TRACK_KEY[f])) out[f] = resolveField(ex.sets, index, f, lastTime);
  }
  return out;
}

export function valuesToPatch(v: SetValues): ActualPatch {
  return {
    actualReps: v.reps,
    actualWeightKg: v.weightKg,
    actualDurationS: v.durationS,
    actualDistanceM: v.distanceM,
  };
}
