import type { TrackingType } from '../exercises/tracking';
import { MAX_SUBSTITUTES } from './schema';
import type { WorkoutBlockDoc, WorkoutDoc, WorkoutExerciseDoc, WorkoutSetDoc, WorkoutSubstituteDoc } from './schema';
import { MAX_CHOICE_OPTIONS, MIN_CHOICE_OPTIONS } from './sections';
import { TARGET_FIELDS } from './targets';

export type ExercisePick = { id: string; name: string; trackingType: TrackingType };

const DEFAULT_ROUNDS = 3;
const DEFAULT_REST = 90;
const MAX_SETS = 20;
const MAX_EXERCISES = 10;
const MAX_BLOCKS = 30;
const MAX_SECTIONS = 10;
const MAX_SECTION_NAME = 40;

const lastSectionId = (doc: WorkoutDoc): string | null => doc.sections[doc.sections.length - 1]?.id ?? null;

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
    substitutes: [],
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
  return { id: makeId(), name, notes: null, sections: [], blocks: [] };
}

export function addStraightBlock(doc: WorkoutDoc, ex: ExercisePick, makeId: () => string): WorkoutDoc {
  if (doc.blocks.length >= MAX_BLOCKS) return doc;
  const block: WorkoutBlockDoc = {
    id: makeId(),
    sectionId: lastSectionId(doc),
    kind: 'straight',
    exercises: [newExercise(ex, DEFAULT_REST, DEFAULT_ROUNDS, makeId)],
  };
  return { ...doc, blocks: [...doc.blocks, block] };
}

export function addSuperset(doc: WorkoutDoc, exs: ExercisePick[], makeId: () => string): WorkoutDoc {
  if (exs.length < 2) throw new Error('A superset needs at least two exercises.');
  if (exs.length > MAX_EXERCISES || doc.blocks.length >= MAX_BLOCKS) return doc;
  const block: WorkoutBlockDoc = {
    id: makeId(),
    sectionId: lastSectionId(doc),
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

/** Removing a section's last block removes the section too, because a section is never empty. */
export function removeBlock(doc: WorkoutDoc, blockId: string): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  if (!block) return doc;
  const blocks = doc.blocks.filter((b) => b.id !== blockId);
  const sid = block.sectionId;
  const sections =
    sid !== null && !blocks.some((b) => b.sectionId === sid) ? doc.sections.filter((s) => s.id !== sid) : doc.sections;
  return { ...doc, sections, blocks };
}

/** Stable regroup: unsectioned blocks first, then each section's blocks in section order. */
function regroup(sections: WorkoutDoc['sections'], blocks: WorkoutBlockDoc[]): WorkoutBlockDoc[] {
  const rank = (b: WorkoutBlockDoc) => sections.findIndex((s) => s.id === b.sectionId);
  return blocks
    .map((b, i) => ({ b, i, r: rank(b) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.b);
}

/** A block only moves inside its own section's run, so sections stay contiguous. */
export function moveBlock(doc: WorkoutDoc, blockId: string, toIndex: number): WorkoutDoc {
  const from = doc.blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return doc;
  const sid = doc.blocks[from]!.sectionId;
  const own = doc.blocks.flatMap((b, i) => (b.sectionId === sid ? [i] : []));
  const to = Math.max(own[0]!, Math.min(own[own.length - 1]!, toIndex));
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved!);
  return { ...doc, blocks };
}

const cleanName = (name: string): string | null => {
  const n = name.trim();
  return n.length >= 1 && n.length <= MAX_SECTION_NAME ? n : null;
};

export function addSection(doc: WorkoutDoc, name: string, makeId: () => string): WorkoutDoc {
  const n = cleanName(name);
  if (n === null || doc.sections.length >= MAX_SECTIONS) return doc;
  return { ...doc, sections: [...doc.sections, { id: makeId(), name: n }] };
}

export function renameSection(doc: WorkoutDoc, sectionId: string, name: string): WorkoutDoc {
  const n = cleanName(name);
  if (n === null || !doc.sections.some((s) => s.id === sectionId)) return doc;
  return { ...doc, sections: doc.sections.map((s) => (s.id === sectionId ? { ...s, name: n } : s)) };
}

/** Its blocks join the section above, or become unsectioned when it was the first. */
export function removeSection(doc: WorkoutDoc, sectionId: string): WorkoutDoc {
  const i = doc.sections.findIndex((s) => s.id === sectionId);
  if (i < 0) return doc;
  const above = doc.sections[i - 1]?.id ?? null;
  return {
    ...doc,
    sections: doc.sections.filter((s) => s.id !== sectionId),
    blocks: doc.blocks.map((b) => (b.sectionId === sectionId ? { ...b, sectionId: above } : b)),
  };
}

/** Swaps with the neighbouring section; both runs of blocks move with it. */
export function moveSection(doc: WorkoutDoc, sectionId: string, delta: -1 | 1): WorkoutDoc {
  const i = doc.sections.findIndex((s) => s.id === sectionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.sections.length) return doc;
  const sections = [...doc.sections];
  [sections[i], sections[j]] = [sections[j]!, sections[i]!];
  return { ...doc, sections, blocks: regroup(sections, doc.blocks) };
}

/** Puts the block at the end of that section's run (null: the unsectioned run at the top). */
export function moveBlockToSection(doc: WorkoutDoc, blockId: string, sectionId: string | null): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  if (!block || (sectionId !== null && !doc.sections.some((s) => s.id === sectionId))) return doc;
  const others = doc.blocks.filter((b) => b.id !== blockId);
  const blocks = regroup(doc.sections, [...others, { ...block, sectionId }]);
  // Removing the block may leave its old section empty; sections are never empty.
  const old = block.sectionId;
  const sections =
    old !== null && old !== sectionId && !blocks.some((b) => b.sectionId === old)
      ? doc.sections.filter((s) => s.id !== old)
      : doc.sections;
  return { ...doc, sections, blocks };
}

export function addChoice(doc: WorkoutDoc, exs: ExercisePick[], makeId: () => string): WorkoutDoc {
  if (exs.length < MIN_CHOICE_OPTIONS || exs.length > MAX_CHOICE_OPTIONS || doc.blocks.length >= MAX_BLOCKS) return doc;
  const block: WorkoutBlockDoc = {
    id: makeId(),
    sectionId: lastSectionId(doc),
    kind: 'choice',
    exercises: exs.map((ex) => newExercise(ex, DEFAULT_REST, DEFAULT_ROUNDS, makeId)),
  };
  return { ...doc, blocks: [...doc.blocks, block] };
}

export function addChoiceOption(doc: WorkoutDoc, blockId: string, ex: ExercisePick, makeId: () => string): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  if (!block || block.kind !== 'choice' || block.exercises.length >= MAX_CHOICE_OPTIONS) return doc;
  return mapBlock(doc, blockId, (b) => ({
    ...b,
    exercises: [...b.exercises, newExercise(ex, DEFAULT_REST, DEFAULT_ROUNDS, makeId)],
  }));
}

export function removeExercise(doc: WorkoutDoc, blockId: string, workoutExerciseId: string): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  if (!block) return doc;
  const index = block.exercises.findIndex((e) => e.id === workoutExerciseId);
  if (index < 0) return doc;
  if (block.exercises.length === 1) return removeBlock(doc, blockId);
  const removed = block.exercises[index]!;
  let exercises = block.exercises.filter((e) => e.id !== workoutExerciseId);
  if (block.kind === 'superset' && index === block.exercises.length - 1) {
    // The removed exercise carried the per-round rest; hand it to the new last exercise.
    const rests = removed.sets.filter((s) => s.setType !== 'drop').map((s) => s.restSeconds);
    const last = exercises[exercises.length - 1]!;
    exercises = [...exercises.slice(0, -1), withRest(last, (s, r) => rests[r] ?? s.restSeconds)];
  }
  const kind = exercises.length === 1 ? 'straight' : block.kind;
  return mapBlock(doc, blockId, (b) => ({ ...b, kind, exercises }));
}

const roundCount = (e: WorkoutExerciseDoc) => e.sets.filter((s) => s.setType !== 'drop').length;

/** True when a later exercise of the block also has a set in this 1-based round. */
const roundHasLaterExercise = (b: WorkoutBlockDoc, exerciseIndex: number, round: number) =>
  b.exercises.slice(exerciseIndex + 1).some((e) => roundCount(e) >= round);

/**
 * Whether a set's rest box means anything (the builder shows it only then). Outside a superset, always. In a
 * superset the round rest sits on the last exercise of the round, so a set rests only when no later exercise has a
 * set in its round: every set of the last exercise, plus the extra rounds of a longer one (supersets may be uneven).
 */
export function setShowsRest(block: WorkoutBlockDoc, exerciseIndex: number, setIndex: number): boolean {
  const ex = block.exercises[exerciseIndex];
  if (!ex || !ex.sets[setIndex]) return false;
  if (block.kind !== 'superset') return true;
  const round = Math.max(1, roundCount({ ...ex, sets: ex.sets.slice(0, setIndex + 1) }));
  return !roundHasLaterExercise(block, exerciseIndex, round);
}

/**
 * Adds a set to one exercise. Supersets may be uneven, so this never touches the other exercises (use addRound for
 * all). On a superset exercise that isn't last, the new set goes straight on (rest 0) when a later exercise has a set
 * in its round, and otherwise takes the block's round rest (the last exercise's last rest), so the client still rests.
 */
export function addSet(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, makeId: () => string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    const i = b.exercises.findIndex((e) => e.id === workoutExerciseId);
    const e = b.exercises[i];
    if (!e || e.sets.length >= MAX_SETS) return b;
    const from = lastNonDrop(e.sets);
    let rest = from?.restSeconds ?? DEFAULT_REST;
    if (b.kind === 'superset' && i < b.exercises.length - 1) {
      rest = roundHasLaterExercise(b, i, roundCount(e) + 1)
        ? 0
        : (lastNonDrop(b.exercises[b.exercises.length - 1]!.sets)?.restSeconds ?? DEFAULT_REST);
    }
    const added = { ...e, sets: [...e.sets, newSet(makeId, rest, from)] };
    return { ...b, exercises: b.exercises.map((x, xi) => (xi === i ? added : x)) };
  });
}

export function addRound(doc: WorkoutDoc, blockId: string, makeId: () => string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    if (b.kind !== 'superset' || b.exercises.some((e) => e.sets.length >= MAX_SETS)) return b; // choice groups have no rounds
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

/** Removes one set (and the drops that follow it) from one exercise; never touches the other exercises of a superset. */
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
  const block = doc.blocks.find((b) => b.id === blockId);
  const ex = block?.exercises.find((e) => e.id === workoutExerciseId);
  if (!block || !ex) return doc;
  const sets = ex.sets.map((s) => {
    if (s.id !== setId) return s;
    const next = { ...s, ...patch };
    return next.setType === 'drop' ? { ...next, restSeconds: 0 } : { ...next, toFailure: false };
  });
  if (sets[0]?.setType === 'drop') return doc;
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({ ...e, sets }));
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
    sets: e.sets.map((s) => fitSet(s, allowed)),
    // A substitute that is now the exercise itself would be an alternative to itself.
    substitutes: e.substitutes.filter((sub) => sub.exerciseId !== ex.id),
  }));
}

const fitSet = (s: WorkoutSetDoc, allowed: (typeof TARGET_FIELDS)[TrackingType]): WorkoutSetDoc => ({
  ...s,
  targetRepsMin: allowed.includes('reps') ? s.targetRepsMin : null,
  targetRepsMax: allowed.includes('reps') ? s.targetRepsMax : null,
  targetWeightKg: allowed.includes('weight') ? s.targetWeightKg : null,
  targetDurationS: allowed.includes('duration') ? s.targetDurationS : null,
  targetDistanceM: allowed.includes('distance') ? s.targetDistanceM : null,
});

// Substitutes: a coach-added alternative to one planned exercise, with its own sets. Not for pick-one groups,
// whose options are already alternatives. Every op below returns the same doc when it refuses.

export type SubstitutePatch = { note?: string | null };

function mapSubstitute(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  fn: (s: WorkoutSubstituteDoc) => WorkoutSubstituteDoc,
): WorkoutDoc {
  const sub = doc.blocks
    .find((b) => b.id === blockId)
    ?.exercises.find((e) => e.id === workoutExerciseId)
    ?.substitutes.find((x) => x.id === substituteId);
  if (!sub) return doc;
  const next = fn(sub);
  if (next === sub) return doc;
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({
    ...e,
    substitutes: e.substitutes.map((x) => (x.id === substituteId ? next : x)),
  }));
}

/**
 * Adds `ex` as a substitute for one exercise. Its sets start as a copy of the exercise's sets (new ids), minus the
 * targets the substitute's tracking type doesn't use. Refused inside a pick-one group, past 3 substitutes, or when
 * `ex` is the exercise itself or already one of its substitutes.
 */
export function addSubstitute(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  ex: ExercisePick,
  makeId: () => string,
): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  const e = block?.exercises.find((x) => x.id === workoutExerciseId);
  if (!block || !e || block.kind === 'choice') return doc;
  if (e.substitutes.length >= MAX_SUBSTITUTES) return doc;
  if (e.exerciseId === ex.id || e.substitutes.some((x) => x.exerciseId === ex.id)) return doc;
  const allowed = TARGET_FIELDS[ex.trackingType];
  const sub: WorkoutSubstituteDoc = {
    id: makeId(),
    exerciseId: ex.id,
    exerciseName: ex.name,
    trackingType: ex.trackingType,
    note: null,
    sets: e.sets.map((s) => ({ ...fitSet(s, allowed), id: makeId() })),
  };
  return mapExercise(doc, blockId, workoutExerciseId, (x) => ({ ...x, substitutes: [...x.substitutes, sub] }));
}

export function removeSubstitute(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, substituteId: string): WorkoutDoc {
  const e = doc.blocks.find((b) => b.id === blockId)?.exercises.find((x) => x.id === workoutExerciseId);
  if (!e || !e.substitutes.some((x) => x.id === substituteId)) return doc;
  return mapExercise(doc, blockId, workoutExerciseId, (x) => ({
    ...x,
    substitutes: x.substitutes.filter((sub) => sub.id !== substituteId),
  }));
}

/** Changes a substitute's coach note (null clears it). */
export function updateSubstitute(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  patch: SubstitutePatch,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) =>
    patch.note === undefined || patch.note === s.note ? s : { ...s, note: patch.note },
  );
}

/** Adds a set to a substitute, copying the targets and rest of its last working set. */
export function addSubstituteSet(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  makeId: () => string,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) => {
    if (s.sets.length >= MAX_SETS) return s;
    const from = lastNonDrop(s.sets);
    return { ...s, sets: [...s.sets, newSet(makeId, from?.restSeconds ?? DEFAULT_REST, from)] };
  });
}

/** Adds a drop after a substitute's set (and its existing drops), like addDrop. */
export function addSubstituteDrop(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  parentSetId: string,
  makeId: () => string,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) => {
    const p = s.sets.findIndex((x) => x.id === parentSetId);
    if (p < 0 || s.sets[p]!.setType === 'drop' || s.sets.length >= MAX_SETS) return s;
    let at = p + 1;
    while (at < s.sets.length && s.sets[at]!.setType === 'drop') at += 1;
    const drop: WorkoutSetDoc = { ...newSet(makeId, 0), setType: 'drop' };
    return { ...s, sets: [...s.sets.slice(0, at), drop, ...s.sets.slice(at)] };
  });
}

/** Removes one set of a substitute and the drops that follow it; a substitute keeps at least one working set. */
export function removeSubstituteSet(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  setId: string,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) => {
    const i = s.sets.findIndex((x) => x.id === setId);
    if (i < 0) return s;
    if (s.sets[i]!.setType === 'drop') return { ...s, sets: s.sets.filter((x) => x.id !== setId) };
    if (s.sets.filter((x) => x.setType !== 'drop').length <= 1) return s;
    let end = i + 1;
    while (end < s.sets.length && s.sets[end]!.setType === 'drop') end += 1;
    return { ...s, sets: [...s.sets.slice(0, i), ...s.sets.slice(end)] };
  });
}

/** Same rules as updateSet: a drop has no rest, only drops can be "to failure", the first set is never a drop. */
export function updateSubstituteSet(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  setId: string,
  patch: Patch,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) => {
    if (!s.sets.some((x) => x.id === setId)) return s;
    const sets = s.sets.map((x) => {
      if (x.id !== setId) return x;
      const next = { ...x, ...patch };
      return next.setType === 'drop' ? { ...next, restSeconds: 0 } : { ...next, toFailure: false };
    });
    return sets[0]?.setType === 'drop' ? s : { ...s, sets };
  });
}

/** Whether a substitute's set shows a rest box: as for the exercise it stands in for (see setShowsRest). */
export function substituteSetShowsRest(
  block: WorkoutBlockDoc,
  exerciseIndex: number,
  substitute: Pick<WorkoutSubstituteDoc, 'sets'>,
  setIndex: number,
): boolean {
  const ex = block.exercises[exerciseIndex];
  if (!ex) return false;
  const stand = { ...block, exercises: block.exercises.map((e, i) => (i === exerciseIndex ? { ...e, sets: substitute.sets } : e)) };
  return setShowsRest(stand, exerciseIndex, setIndex);
}
