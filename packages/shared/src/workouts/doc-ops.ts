import type { TrackingType } from '../exercises/tracking';
import type { WorkoutBlockDoc, WorkoutDoc, WorkoutExerciseDoc, WorkoutSetDoc } from './schema';
import { TARGET_FIELDS } from './targets';

export type ExercisePick = { id: string; name: string; trackingType: TrackingType };

const DEFAULT_ROUNDS = 3;
const DEFAULT_REST = 90;
const MAX_SETS = 20;
const MAX_EXERCISES = 10;

type Patch = Partial<Omit<WorkoutSetDoc, 'id'>>;

function newSet(makeId: () => string, rest: number, from?: WorkoutSetDoc): WorkoutSetDoc {
  return {
    id: makeId(),
    setType: 'normal',
    targetRepsMin: from?.targetRepsMin ?? null,
    targetRepsMax: from?.targetRepsMax ?? null,
    targetWeightKg: from?.targetWeightKg ?? null,
    targetDurationS: from?.targetDurationS ?? null,
    targetDistanceM: from?.targetDistanceM ?? null,
    toFailure: false,
    restSeconds: rest,
    note: null,
  };
}

function newExercise(ex: ExercisePick, rest: number, rounds: number, makeId: () => string): WorkoutExerciseDoc {
  return {
    id: makeId(),
    exerciseId: ex.id,
    exerciseName: ex.name,
    trackingType: ex.trackingType,
    note: null,
    sets: Array.from({ length: rounds }, () => newSet(makeId, rest)),
  };
}

const lastNonDrop = (sets: readonly WorkoutSetDoc[]): WorkoutSetDoc | undefined =>
  [...sets].reverse().find((s) => s.setType !== 'drop');

const withRest = (e: WorkoutExerciseDoc, rest: (s: WorkoutSetDoc, roundIndex: number) => number): WorkoutExerciseDoc => {
  let round = -1;
  return {
    ...e,
    sets: e.sets.map((s) => {
      if (s.setType === 'drop') return s;
      round += 1;
      return { ...s, restSeconds: rest(s, round) };
    }),
  };
};

function mapBlock(doc: WorkoutDoc, blockId: string, fn: (b: WorkoutBlockDoc) => WorkoutBlockDoc): WorkoutDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === blockId ? fn(b) : b)) };
}

function mapExercise(
  doc: WorkoutDoc,
  blockId: string,
  exId: string,
  fn: (e: WorkoutExerciseDoc) => WorkoutExerciseDoc,
): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => ({ ...b, exercises: b.exercises.map((e) => (e.id === exId ? fn(e) : e)) }));
}

export function emptyWorkout(makeId: () => string, name = ''): WorkoutDoc {
  return { id: makeId(), name, notes: null, blocks: [] };
}

export function addStraightBlock(doc: WorkoutDoc, ex: ExercisePick, makeId: () => string): WorkoutDoc {
  const block: WorkoutBlockDoc = {
    id: makeId(),
    kind: 'straight',
    exercises: [newExercise(ex, DEFAULT_REST, DEFAULT_ROUNDS, makeId)],
  };
  return { ...doc, blocks: [...doc.blocks, block] };
}

export function addSuperset(doc: WorkoutDoc, exs: ExercisePick[], makeId: () => string): WorkoutDoc {
  if (exs.length < 2) throw new Error('A superset needs at least two exercises.');
  const block: WorkoutBlockDoc = {
    id: makeId(),
    kind: 'superset',
    exercises: exs.map((ex, i) =>
      newExercise(ex, i === exs.length - 1 ? DEFAULT_REST : 0, DEFAULT_ROUNDS, makeId),
    ),
  };
  return { ...doc, blocks: [...doc.blocks, block] };
}

/** The new exercise goes last, so it takes over the per-round rest and the previous last exercise drops to 0. */
export function addExerciseToSuperset(doc: WorkoutDoc, blockId: string, ex: ExercisePick, makeId: () => string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    if (b.kind !== 'superset' || b.exercises.length >= MAX_EXERCISES) return b;
    const prev = b.exercises[b.exercises.length - 1]!;
    const rounds = prev.sets.filter((s) => s.setType !== 'drop');
    const fresh: WorkoutExerciseDoc = {
      ...newExercise(ex, 0, 0, makeId),
      sets: rounds.map((r) => newSet(makeId, r.restSeconds)),
    };
    return {
      ...b,
      exercises: [...b.exercises.slice(0, -1), withRest(prev, () => 0), fresh],
    };
  });
}

export function removeBlock(doc: WorkoutDoc, blockId: string): WorkoutDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => b.id !== blockId) };
}

export function moveBlock(doc: WorkoutDoc, blockId: string, toIndex: number): WorkoutDoc {
  const from = doc.blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.blocks.length - 1, toIndex));
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved!);
  return { ...doc, blocks };
}

export function removeExercise(doc: WorkoutDoc, blockId: string, workoutExerciseId: string): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  if (!block) return doc;
  const index = block.exercises.findIndex((e) => e.id === workoutExerciseId);
  if (index < 0) return doc;
  if (block.exercises.length === 1) return removeBlock(doc, blockId);
  const removed = block.exercises[index]!;
  let exercises = block.exercises.filter((e) => e.id !== workoutExerciseId);
  if (index === block.exercises.length - 1) {
    // The removed exercise carried the per-round rest; hand it to the new last exercise.
    const rests = removed.sets.filter((s) => s.setType !== 'drop').map((s) => s.restSeconds);
    const last = exercises[exercises.length - 1]!;
    exercises = [...exercises.slice(0, -1), withRest(last, (s, r) => rests[r] ?? s.restSeconds)];
  }
  const kind = exercises.length === 1 ? 'straight' : block.kind;
  return mapBlock(doc, blockId, (b) => ({ ...b, kind, exercises }));
}

export function addSet(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, makeId: () => string): WorkoutDoc {
  return mapExercise(doc, blockId, workoutExerciseId, (e) => {
    if (e.sets.length >= MAX_SETS) return e;
    const from = lastNonDrop(e.sets);
    return { ...e, sets: [...e.sets, newSet(makeId, from?.restSeconds ?? DEFAULT_REST, from)] };
  });
}

export function addRound(doc: WorkoutDoc, blockId: string, makeId: () => string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    if (b.kind !== 'superset' || b.exercises.some((e) => e.sets.length >= MAX_SETS)) return b;
    return {
      ...b,
      exercises: b.exercises.map((e, i) => {
        const from = lastNonDrop(e.sets);
        const rest = i === b.exercises.length - 1 ? (from?.restSeconds ?? DEFAULT_REST) : 0;
        return { ...e, sets: [...e.sets, newSet(makeId, rest, from)] };
      }),
    };
  });
}

function dropLastRound(e: WorkoutExerciseDoc): WorkoutExerciseDoc {
  let i = e.sets.length - 1;
  while (i >= 0 && e.sets[i]!.setType === 'drop') i -= 1;
  return { ...e, sets: e.sets.slice(0, i) };
}

export function removeRound(doc: WorkoutDoc, blockId: string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    if (b.kind !== 'superset') return b;
    if (b.exercises.some((e) => e.sets.filter((s) => s.setType !== 'drop').length <= 1)) return b;
    return { ...b, exercises: b.exercises.map(dropLastRound) };
  });
}

export function addDrop(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  parentSetId: string,
  makeId: () => string,
): WorkoutDoc {
  return mapExercise(doc, blockId, workoutExerciseId, (e) => {
    const p = e.sets.findIndex((s) => s.id === parentSetId);
    if (p < 0 || e.sets[p]!.setType === 'drop' || e.sets.length >= MAX_SETS) return e;
    let at = p + 1;
    while (at < e.sets.length && e.sets[at]!.setType === 'drop') at += 1;
    const drop: WorkoutSetDoc = { ...newSet(makeId, 0), setType: 'drop' };
    return { ...e, sets: [...e.sets.slice(0, at), drop, ...e.sets.slice(at)] };
  });
}

export function removeSet(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, setId: string): WorkoutDoc {
  return mapExercise(doc, blockId, workoutExerciseId, (e) => {
    const i = e.sets.findIndex((s) => s.id === setId);
    if (i < 0) return e;
    if (e.sets[i]!.setType === 'drop') return { ...e, sets: e.sets.filter((s) => s.id !== setId) };
    if (e.sets.filter((s) => s.setType !== 'drop').length <= 1) return e;
    let end = i + 1;
    while (end < e.sets.length && e.sets[end]!.setType === 'drop') end += 1;
    return { ...e, sets: [...e.sets.slice(0, i), ...e.sets.slice(end)] };
  });
}

export function updateSet(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  setId: string,
  patch: Patch,
): WorkoutDoc {
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({
    ...e,
    sets: e.sets.map((s) => {
      if (s.id !== setId) return s;
      const next = { ...s, ...patch };
      return next.setType === 'drop' ? { ...next, restSeconds: 0 } : next;
    }),
  }));
}

export function replaceExercise(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  ex: ExercisePick,
): WorkoutDoc {
  const allowed = TARGET_FIELDS[ex.trackingType];
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({
    ...e,
    exerciseId: ex.id,
    exerciseName: ex.name,
    trackingType: ex.trackingType,
    sets: e.sets.map((s) => ({
      ...s,
      targetRepsMin: allowed.includes('reps') ? s.targetRepsMin : null,
      targetRepsMax: allowed.includes('reps') ? s.targetRepsMax : null,
      targetWeightKg: allowed.includes('weight') ? s.targetWeightKg : null,
      targetDurationS: allowed.includes('duration') ? s.targetDurationS : null,
      targetDistanceM: allowed.includes('distance') ? s.targetDistanceM : null,
    })),
  }));
}
