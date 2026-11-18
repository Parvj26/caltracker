import type { TrackingType } from '../exercises/tracking';
import { MAX_SUBSTITUTES } from './schema';
import type { WorkoutBlockDoc, WorkoutDoc, WorkoutExerciseDoc, WorkoutSetDoc, WorkoutSubstituteDoc } from './schema';
import { MAX_CHOICE_OPTIONS, MIN_CHOICE_OPTIONS } from './sections';
import { toggleMeasurement } from './measurements';
import type { Measurement } from './measurements';
import { fitSetTargets, targetFieldsFor } from './targets';

/**
 * An exercise picked in the builder. `trackingType` is the library kind, or the coach's last choice of measurements
 * for it (applyExercisePrefs), as is `eachSide`.
 */
export type ExercisePick = { id: string; name: string; trackingType: TrackingType; eachSide?: boolean };

/** Sets a new exercise starts with by default, and the most one exercise may have. */
export const DEFAULT_SETS = 3;
/** Sets an exercise added in the coach's builder starts with: one, and "+ Set" copies it. */
export const BUILDER_SETS = 1;
const DEFAULT_REST = 90;
export const MAX_SETS = 20;
const MAX_EXERCISES = 10;
export const MAX_BLOCKS = 30;
const MAX_SECTIONS = 10;
const MAX_SECTION_NAME = 40;

/** A set count from the builder (1 to 20 sets; anything else is clamped or rounded). */
const clampSets = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_SETS, Math.max(1, Math.round(n))) : DEFAULT_SETS);

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
    eachSide: ex.eachSide === true,
    tempo: null,
    sets: Array.from({ length: rounds }, () => newSet(makeId, rest)),
    substitutes: [],
  };
}

/**
 * "+ Set": a copy of the exercise's last set (its type, failure flag, targets and rest) with a new id and no note.
 * A drop copies as a drop (no rest), so a run of drops grows the way the coach expects.
 */
function copyOfLast(makeId: () => string, sets: readonly WorkoutSetDoc[], rest: number): WorkoutSetDoc {
  const last = sets[sets.length - 1];
  if (!last) return newSet(makeId, rest);
  return fitKind({ ...last, id: makeId(), note: null, restSeconds: rest });
}

/** The set rules every edit keeps: a drop has no rest of its own, and a warm-up is never "to failure". */
function fitKind(s: WorkoutSetDoc): WorkoutSetDoc {
  if (s.setType === 'drop') return s.restSeconds === 0 ? s : { ...s, restSeconds: 0 };
  return s.setType === 'warmup' && s.toFailure ? { ...s, toFailure: false } : s;
}

/**
 * The sets without one row (the editor shows drops as rows of their own, so removing a set never takes the drops
 * below it: they then follow the set above). A drop left first becomes a normal set, since a drop must follow one.
 * Null when the row isn't there or is the only set (an exercise keeps at least one).
 */
function withoutRow(sets: readonly WorkoutSetDoc[], setId: string): WorkoutSetDoc[] | null {
  if (sets.length <= 1 || !sets.some((s) => s.id === setId)) return null;
  const rest = sets.filter((s) => s.id !== setId);
  const first = rest[0]!;
  return first.setType === 'drop' ? [{ ...first, setType: 'normal' }, ...rest.slice(1)] : rest;
}

const lastNonDrop = (sets: readonly WorkoutSetDoc[]): WorkoutSetDoc | undefined =>
  [...sets].reverse().find((s) => s.setType !== 'drop');

function restOf(sets: readonly WorkoutSetDoc[], rest: (s: WorkoutSetDoc, roundIndex: number) => number): WorkoutSetDoc[] {
  let round = -1;
  return sets.map((s) => {
    if (s.setType === 'drop') return s;
    round += 1;
    return { ...s, restSeconds: rest(s, round) };
  });
}

/** Sets the rest of each round; a substitute stands in for its exercise, so its sets follow the same rule. */
const withRest = (e: WorkoutExerciseDoc, rest: (s: WorkoutSetDoc, roundIndex: number) => number): WorkoutExerciseDoc => ({
  ...e,
  sets: restOf(e.sets, rest),
  substitutes: e.substitutes.map((sub) => ({ ...sub, sets: restOf(sub.sets, rest) })),
});

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

export function addStraightBlock(doc: WorkoutDoc, ex: ExercisePick, makeId: () => string, sets = DEFAULT_SETS): WorkoutDoc {
  if (doc.blocks.length >= MAX_BLOCKS) return doc;
  const block: WorkoutBlockDoc = {
    id: makeId(),
    sectionId: lastSectionId(doc),
    kind: 'straight',
    exercises: [newExercise(ex, DEFAULT_REST, clampSets(sets), makeId)],
  };
  return { ...doc, blocks: [...doc.blocks, block] };
}

/** Each pick becomes its own straight block, in pick order, until the 30-block cap. */
export function addStraightBlocks(
  doc: WorkoutDoc,
  exs: readonly ExercisePick[],
  makeId: () => string,
  sets = DEFAULT_SETS,
): WorkoutDoc {
  return exs.reduce((d, ex) => addStraightBlock(d, ex, makeId, sets), doc);
}

export function addSuperset(doc: WorkoutDoc, exs: ExercisePick[], makeId: () => string, rounds = DEFAULT_SETS): WorkoutDoc {
  if (exs.length < 2) throw new Error('A superset needs at least two exercises.');
  if (exs.length > MAX_EXERCISES || doc.blocks.length >= MAX_BLOCKS) return doc;
  const block: WorkoutBlockDoc = {
    id: makeId(),
    sectionId: lastSectionId(doc),
    kind: 'superset',
    exercises: exs.map((ex, i) =>
      newExercise(ex, i === exs.length - 1 ? DEFAULT_REST : 0, clampSets(rounds), makeId),
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

export function addChoice(doc: WorkoutDoc, exs: ExercisePick[], makeId: () => string, sets = DEFAULT_SETS): WorkoutDoc {
  if (exs.length < MIN_CHOICE_OPTIONS || exs.length > MAX_CHOICE_OPTIONS || doc.blocks.length >= MAX_BLOCKS) return doc;
  const block: WorkoutBlockDoc = {
    id: makeId(),
    sectionId: lastSectionId(doc),
    kind: 'choice',
    exercises: exs.map((ex) => newExercise(ex, DEFAULT_REST, clampSets(sets), makeId)),
  };
  return { ...doc, blocks: [...doc.blocks, block] };
}

export function addChoiceOption(
  doc: WorkoutDoc,
  blockId: string,
  ex: ExercisePick,
  makeId: () => string,
  sets = DEFAULT_SETS,
): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  if (!block || block.kind !== 'choice' || block.exercises.length >= MAX_CHOICE_OPTIONS) return doc;
  return mapBlock(doc, blockId, (b) => ({
    ...b,
    exercises: [...b.exercises, newExercise(ex, DEFAULT_REST, clampSets(sets), makeId)],
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
 * Adds a copy of the last set to one exercise (see copyOfLast). Supersets may be uneven, so this never touches the other exercises (use addRound for
 * all). On a superset exercise that isn't last, the new set goes straight on (rest 0) when a later exercise has a set
 * in its round, and otherwise takes the block's round rest (the last exercise's last rest), so the client still rests.
 */
export function addSet(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, makeId: () => string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    const i = b.exercises.findIndex((e) => e.id === workoutExerciseId);
    const e = b.exercises[i];
    if (!e || e.sets.length >= MAX_SETS) return b;
    const from = e.sets[e.sets.length - 1];
    let rest = from?.restSeconds ?? DEFAULT_REST;
    if (b.kind === 'superset' && i < b.exercises.length - 1) {
      rest = roundHasLaterExercise(b, i, roundCount(e) + 1)
        ? 0
        : (lastNonDrop(b.exercises[b.exercises.length - 1]!.sets)?.restSeconds ?? DEFAULT_REST);
    }
    const added = { ...e, sets: [...e.sets, copyOfLast(makeId, e.sets, rest)] };
    return { ...b, exercises: b.exercises.map((x, xi) => (xi === i ? added : x)) };
  });
}

export function addRound(doc: WorkoutDoc, blockId: string, makeId: () => string): WorkoutDoc {
  return mapBlock(doc, blockId, (b) => {
    // Choice groups have no rounds. Substitutes get the round too, so they keep the same number of sets.
    const full = (sets: readonly WorkoutSetDoc[]) => sets.length >= MAX_SETS;
    if (b.kind !== 'superset' || b.exercises.some((e) => full(e.sets) || e.substitutes.some((x) => full(x.sets)))) return b;
    const last = b.exercises.length - 1;
    const grow = (sets: WorkoutSetDoc[], i: number): WorkoutSetDoc[] => {
      const from = lastNonDrop(sets);
      return [...sets, newSet(makeId, i === last ? (from?.restSeconds ?? DEFAULT_REST) : 0, from)];
    };
    return {
      ...b,
      exercises: b.exercises.map((e, i) => ({
        ...e,
        sets: grow(e.sets, i),
        substitutes: e.substitutes.map((sub) => ({ ...sub, sets: grow(sub.sets, i) })),
      })),
    };
  });
}

function withoutLastRound(sets: WorkoutSetDoc[]): WorkoutSetDoc[] {
  let i = sets.length - 1;
  while (i >= 0 && sets[i]!.setType === 'drop') i -= 1;
  return sets.slice(0, i);
}

/** A substitute loses the round too, unless it is down to one working set (it always keeps one). */
function dropLastRound(e: WorkoutExerciseDoc): WorkoutExerciseDoc {
  return {
    ...e,
    sets: withoutLastRound(e.sets),
    substitutes: e.substitutes.map((sub) =>
      sub.sets.filter((s) => s.setType !== 'drop').length <= 1 ? sub : { ...sub, sets: withoutLastRound(sub.sets) },
    ),
  };
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

/** Removes one set row from one exercise (see withoutRow); never touches the other exercises of a superset. */
export function removeSet(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, setId: string): WorkoutDoc {
  const ex = doc.blocks.find((b) => b.id === blockId)?.exercises.find((e) => e.id === workoutExerciseId);
  const sets = ex ? withoutRow(ex.sets, setId) : null;
  return sets ? mapExercise(doc, blockId, workoutExerciseId, (e) => ({ ...e, sets })) : doc;
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
  const sets = ex.sets.map((s) => (s.id === setId ? fitKind({ ...s, ...patch }) : s));
  if (sets[0]?.setType === 'drop') return doc;
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({ ...e, sets }));
}

export function replaceExercise(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  ex: ExercisePick,
): WorkoutDoc {
  const allowed = targetFieldsFor(ex.trackingType);
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({
    ...e,
    exerciseId: ex.id,
    exerciseName: ex.name,
    trackingType: ex.trackingType,
    // Each side comes with the new exercise (its last choice); the tempo and note stay with the slot.
    eachSide: ex.eachSide === true,
    sets: e.sets.map((s) => fitSet(s, allowed)),
    // A substitute that is now the exercise itself would be an alternative to itself.
    substitutes: e.substitutes.filter((sub) => sub.exerciseId !== ex.id),
  }));
}

const fitSet = (s: WorkoutSetDoc, allowed: ReturnType<typeof targetFieldsFor>): WorkoutSetDoc => ({
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
  const allowed = targetFieldsFor(ex.trackingType);
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

/** Adds a copy of a substitute's last set, as addSet does for an exercise. */
export function addSubstituteSet(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  makeId: () => string,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) => {
    if (s.sets.length >= MAX_SETS) return s;
    const from = s.sets[s.sets.length - 1];
    return { ...s, sets: [...s.sets, copyOfLast(makeId, s.sets, from?.restSeconds ?? DEFAULT_REST)] };
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

/** Removes one set row of a substitute, as removeSet does for an exercise; a substitute keeps at least one set. */
export function removeSubstituteSet(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  substituteId: string,
  setId: string,
): WorkoutDoc {
  return mapSubstitute(doc, blockId, workoutExerciseId, substituteId, (s) => {
    const sets = withoutRow(s.sets, setId);
    return sets ? { ...s, sets } : s;
  });
}

/** Same rules as updateSet: a drop has no rest, a warm-up is never "to failure", the first set is never a drop. */
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
    const sets = s.sets.map((x) => (x.id === setId ? fitKind({ ...x, ...patch }) : x));
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

/**
 * The Measurements menu: turns one of Weight / Reps / Time on or off for this workout exercise. Its sets lose the
 * targets it no longer measures; a newly measured one starts empty. Unticking the last one, or any change to a
 * distance exercise, changes nothing (same doc).
 */
export function toggleExerciseMeasurement(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  m: Measurement,
): WorkoutDoc {
  const ex = doc.blocks.find((b) => b.id === blockId)?.exercises.find((e) => e.id === workoutExerciseId);
  if (!ex) return doc;
  const trackingType = toggleMeasurement(ex.trackingType, m);
  if (trackingType === ex.trackingType) return doc;
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({
    ...e,
    trackingType,
    sets: e.sets.map((s) => fitSetTargets(trackingType, s)),
  }));
}

/** Each side and Tempo, above "+ Set". The tempo is kept as typed; WorkoutDoc checks and normalises it on save. */
export function updateExerciseOptions(
  doc: WorkoutDoc,
  blockId: string,
  workoutExerciseId: string,
  patch: { eachSide?: boolean; tempo?: string | null },
): WorkoutDoc {
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({ ...e, ...patch }));
}

// The builder's "Superset" switch between two exercises, its Reorder window and the Rest checkbox.

/** The 1-based rounds of an exercise that a later exercise of the block also has a set in (its rest is 0 there). */
const coveredRest = (b: WorkoutBlockDoc, i: number) => (s: WorkoutSetDoc, r: number) =>
  roundHasLaterExercise(b, i, r + 1) ? 0 : s.restSeconds;

/** The rest after a round: the rest of the round's last exercise (the last one with a set in it). */
function roundRest(b: WorkoutBlockDoc, round: number): number | undefined {
  for (let i = b.exercises.length - 1; i >= 0; i -= 1) {
    const set = b.exercises[i]!.sets.filter((s) => s.setType !== 'drop')[round];
    if (set) return set.restSeconds;
  }
  return undefined;
}

/**
 * An exercise moving to another block gets new ids (with its sets and substitutes): the server keeps each saved row
 * in its own block, so a moved row is saved as a new one and the old one goes.
 */
function reIded(e: WorkoutExerciseDoc, makeId: () => string): WorkoutExerciseDoc {
  const sets = (xs: readonly WorkoutSetDoc[]) => xs.map((x) => ({ ...x, id: makeId() }));
  return {
    ...e,
    id: makeId(),
    sets: sets(e.sets),
    substitutes: e.substitutes.map((sub) => ({ ...sub, id: makeId(), sets: sets(sub.sets) })),
  };
}

/**
 * Whether the switch between this block and the next one can join them: same section, neither a pick-one group,
 * and at most 10 exercises together.
 */
export function canJoinWithNext(doc: WorkoutDoc, blockId: string): boolean {
  const i = doc.blocks.findIndex((b) => b.id === blockId);
  const a = doc.blocks[i];
  const b = doc.blocks[i + 1];
  if (!a || !b || a.sectionId !== b.sectionId || a.kind === 'choice' || b.kind === 'choice') return false;
  return a.exercises.length + b.exercises.length <= MAX_EXERCISES;
}

/**
 * The switch turned on: this block and the next become one superset (either may already be one, so switches chain
 * into a superset of 3 or more). Each exercise keeps its own sets (uneven rounds are fine). The rest after a round sits
 * on the round's last exercise, so an earlier exercise's set gets rest 0 wherever a later exercise has a set in its
 * round. The next block's exercises move into this one (with new ids, see reIded). Refused (same doc) when
 * canJoinWithNext is false.
 */
export function joinWithNext(doc: WorkoutDoc, blockId: string, makeId: () => string): WorkoutDoc {
  if (!canJoinWithNext(doc, blockId)) return doc;
  const i = doc.blocks.findIndex((b) => b.id === blockId);
  const a = doc.blocks[i]!;
  const next = doc.blocks[i + 1]!;
  const joined: WorkoutBlockDoc = { ...a, kind: 'superset', exercises: [...a.exercises, ...next.exercises.map((e) => reIded(e, makeId))] };
  const block = { ...joined, exercises: joined.exercises.map((e, ei) => withRest(e, coveredRest(joined, ei))) };
  return { ...doc, blocks: [...doc.blocks.slice(0, i), block, ...doc.blocks.slice(i + 2)] };
}

/**
 * The switch turned off: the superset splits before exercise `at` (1 to length-1). The exercises after it become a new
 * block straight below (with new ids, see reIded); a part left with one exercise is a straight block. A set that loses the later exercise it
 * went straight on to gets the rest the round had (1:30 when unknown), so the client still rests. Refused (same doc)
 * at the 30-block cap or for a bad `at`.
 */
export function splitSuperset(doc: WorkoutDoc, blockId: string, at: number, makeId: () => string): WorkoutDoc {
  const i = doc.blocks.findIndex((b) => b.id === blockId);
  const b = doc.blocks[i];
  if (!b || b.kind !== 'superset' || at < 1 || at >= b.exercises.length || doc.blocks.length >= MAX_BLOCKS) return doc;
  const kindOf = (n: number): WorkoutBlockDoc['kind'] => (n > 1 ? 'superset' : 'straight');
  const head: WorkoutBlockDoc = { ...b, kind: kindOf(at), exercises: b.exercises.slice(0, at) };
  const fixed: WorkoutBlockDoc = {
    ...head,
    exercises: head.exercises.map((e, ei) =>
      withRest(e, (s, r) =>
        roundHasLaterExercise(b, ei, r + 1) && !roundHasLaterExercise(head, ei, r + 1)
          ? (roundRest(b, r) ?? DEFAULT_REST)
          : s.restSeconds,
      ),
    ),
  };
  const tail: WorkoutBlockDoc = { id: makeId(), sectionId: b.sectionId, kind: kindOf(b.exercises.length - at), exercises: b.exercises.slice(at).map((e) => reIded(e, makeId)) };
  return { ...doc, blocks: [...doc.blocks.slice(0, i), fixed, tail, ...doc.blocks.slice(i + 1)] };
}

/**
 * The Reorder window's Done: the blocks in this order. Sections keep their place and each block stays in its own
 * section (regroup), as moveBlock does. Refused (same doc) unless `ids` is exactly the doc's block ids.
 */
export function reorderBlocks(doc: WorkoutDoc, ids: readonly string[]): WorkoutDoc {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  if (ids.length !== doc.blocks.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return doc;
  return { ...doc, blocks: regroup(doc.sections, ids.map((id) => byId.get(id)!)) };
}

/**
 * The Rest checkbox, read from the doc: true when every set of the exercise that shows a rest box rests 0 (the
 * client's phone then shows no rest), false when one rests, null when no set shows a rest box (an exercise that goes
 * straight on to the next one in a superset).
 */
export function exerciseRestOff(block: WorkoutBlockDoc, exerciseIndex: number): boolean | null {
  const ex = block.exercises[exerciseIndex];
  if (!ex) return null;
  const shown = ex.sets.filter((s, si) => s.setType !== 'drop' && setShowsRest(block, exerciseIndex, si));
  return shown.length === 0 ? null : shown.every((s) => s.restSeconds === 0);
}

/**
 * The Rest checkbox: off sets every set's rest (and its substitutes') to 0; on gives each set that shows a rest box
 * and rests 0 the default 1:30.
 */
export function setExerciseRest(doc: WorkoutDoc, blockId: string, workoutExerciseId: string, on: boolean): WorkoutDoc {
  const block = doc.blocks.find((b) => b.id === blockId);
  const ei = block ? block.exercises.findIndex((e) => e.id === workoutExerciseId) : -1;
  if (!block || ei < 0) return doc;
  if (!on) return mapExercise(doc, blockId, workoutExerciseId, (e) => withRest(e, () => 0));
  const fill = (s: WorkoutSetDoc, shows: boolean) =>
    s.setType !== 'drop' && shows && s.restSeconds === 0 ? { ...s, restSeconds: DEFAULT_REST } : s;
  return mapExercise(doc, blockId, workoutExerciseId, (e) => ({
    ...e,
    sets: e.sets.map((s, si) => fill(s, setShowsRest(block, ei, si))),
    substitutes: e.substitutes.map((sub) => ({
      ...sub,
      sets: sub.sets.map((s, si) => fill(s, substituteSetShowsRest(block, ei, sub, si))),
    })),
  }));
}

/** Keeps rest 0 on the exercises whose Rest checkbox is off, after any edit (a split or a new set may give rest). */
export function keepRestOff(doc: WorkoutDoc, off: ReadonlySet<string>): WorkoutDoc {
  if (off.size === 0) return doc;
  const zero = (s: WorkoutSetDoc) => s.setType === 'drop' || s.restSeconds === 0;
  const needs = doc.blocks.some((b) => b.exercises.some((e) => off.has(e.id) && !(e.sets.every(zero) && e.substitutes.every((x) => x.sets.every(zero)))));
  if (!needs) return doc;
  return {
    ...doc,
    blocks: doc.blocks.map((b) => ({ ...b, exercises: b.exercises.map((e) => (off.has(e.id) ? withRest(e, () => 0) : e)) })),
  };
}
