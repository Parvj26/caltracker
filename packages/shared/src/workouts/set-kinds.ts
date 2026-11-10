import type { SetType, WorkoutDoc, WorkoutSetDoc } from './schema';

/**
 * The one-letter set type the coach picks in the builder: W warm-up, N normal, F failure, D drop set. They are not a
 * column of their own: each letter is a pair of the existing set_type and to_failure columns (see setKindPatch), so
 * nothing the phone or the logging code reads changes shape.
 */
export const SET_KINDS = ['W', 'N', 'F', 'D'] as const;
export type SetKind = (typeof SET_KINDS)[number];

export const SET_KIND_NAMES: Record<SetKind, string> = {
  W: 'Warm-up',
  N: 'Normal',
  F: 'Failure',
  D: 'Drop set',
};

/**
 * A set's letter. "To failure" wins over drop, so a drop to failure saved before the letters (only drops could be to
 * failure then) reads F; it is still a drop row, so it stays indented under the set above.
 */
export function setKindOf(s: { setType: SetType; toFailure: boolean }): SetKind {
  if (s.setType === 'warmup') return 'W';
  if (s.toFailure) return 'F';
  return s.setType === 'drop' ? 'D' : 'N';
}

/** The columns a letter stands for. F is a normal set to failure; D is a drop row with no failure flag. */
export function setKindPatch(kind: SetKind): { setType: SetType; toFailure: boolean } {
  switch (kind) {
    case 'W':
      return { setType: 'warmup', toFailure: false };
    case 'N':
      return { setType: 'normal', toFailure: false };
    case 'F':
      return { setType: 'normal', toFailure: true };
    case 'D':
      return { setType: 'drop', toFailure: false };
  }
}

/** The builder takes one rep count per set. A range saved before that reads as its top number (10–12 is 12). */
export function singleReps(min: number | null, max: number | null): number | null {
  return max ?? min;
}

function singleSet(s: WorkoutSetDoc): WorkoutSetDoc {
  const n = singleReps(s.targetRepsMin, s.targetRepsMax);
  return n === s.targetRepsMin && n === s.targetRepsMax ? s : { ...s, targetRepsMin: n, targetRepsMax: n };
}

function mapSets<T extends { sets: WorkoutSetDoc[] }>(o: T): T {
  const sets = o.sets.map(singleSet);
  return sets.every((s, i) => s === o.sets[i]) ? o : { ...o, sets };
}

/**
 * The workout with every rep range (exercises and substitutes) turned into one number, its top: what the builder
 * shows and saves. Returns the same doc when there is no range, so opening an old workout isn't an unsaved change.
 */
export function withSingleReps(doc: WorkoutDoc): WorkoutDoc {
  let changed = false;
  const blocks = doc.blocks.map((b) => {
    const exercises = b.exercises.map((e) => {
      const withSets = mapSets(e);
      const substitutes = e.substitutes.map(mapSets);
      if (withSets === e && substitutes.every((s, i) => s === e.substitutes[i])) return e;
      changed = true;
      return { ...withSets, substitutes };
    });
    return exercises.every((e, i) => e === b.exercises[i]) ? b : { ...b, exercises };
  });
  return changed ? { ...doc, blocks } : doc;
}
