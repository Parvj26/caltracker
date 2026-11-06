import { describe, expect, it } from 'vitest';
import {
  addChoice,
  addChoiceOption,
  addDrop,
  addExerciseToSuperset,
  addRound,
  addSection,
  addSet,
  addStraightBlock,
  addSuperset,
  emptyWorkout,
  moveBlock,
  moveBlockToSection,
  moveSection,
  removeBlock,
  removeExercise,
  removeRound,
  removeSection,
  removeSet,
  renameSection,
  replaceExercise,
  updateSet,
} from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 1000;
const makeId = () => ID(++counter);

const pick = (n: number, trackingType: ExercisePick['trackingType'] = 'weight_reps'): ExercisePick => ({
  id: ID(n),
  name: `Exercise ${n}`,
  trackingType,
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const valid = (d: unknown) => WorkoutDoc.parse(d);
const nonDrop = (sets: { setType: string }[]) => sets.filter((s) => s.setType !== 'drop');

function base() {
  let d = emptyWorkout(makeId, 'Upper A');
  d = addStraightBlock(d, pick(1), makeId);
  d = addSuperset(d, [pick(2), pick(3)], makeId);
  return valid(d);
}

describe('emptyWorkout', () => {
  it('has no blocks and a name', () => {
    const d = emptyWorkout(makeId, 'X');
    expect(d.blocks).toEqual([]);
    expect(d.name).toBe('X');
    expect(emptyWorkout(makeId).name).toBe('');
    expect(WorkoutDoc.safeParse(d).success).toBe(false);
  });
});

describe('add blocks', () => {
  it('addStraightBlock makes 3 normal sets, null targets, rest 90', () => {
    const d = valid(addStraightBlock(emptyWorkout(makeId, 'A'), pick(1), makeId));
    const b = d.blocks[0]!;
    expect(b.kind).toBe('straight');
    expect(b.exercises[0]!.exerciseId).toBe(ID(1));
    expect(b.exercises[0]!.sets).toHaveLength(3);
    for (const s of b.exercises[0]!.sets) {
      expect(s).toMatchObject({
        setType: 'normal',
        targetRepsMin: null,
        targetRepsMax: null,
        targetWeightKg: null,
        targetDurationS: null,
        targetDistanceM: null,
        toFailure: false,
        restSeconds: 90,
      });
    }
  });

  it('addSuperset makes 3 rounds with rest 0 except on the last exercise', () => {
    const b = valid(addSuperset(emptyWorkout(makeId, 'A'), [pick(1), pick(2)], makeId)).blocks[0]!;
    expect(b.kind).toBe('superset');
    expect(b.exercises[0]!.sets.map((s) => s.restSeconds)).toEqual([0, 0, 0]);
    expect(b.exercises[1]!.sets.map((s) => s.restSeconds)).toEqual([90, 90, 90]);
  });

  it('addSuperset rejects fewer than two exercises', () => {
    expect(() => addSuperset(emptyWorkout(makeId, 'A'), [pick(1)], makeId)).toThrow();
  });

  it('addExerciseToSuperset matches round count and keeps the rest rule', () => {
    let d = base();
    const blockId = d.blocks[1]!.id;
    d = addRound(d, blockId, makeId);
    d = valid(addExerciseToSuperset(d, blockId, pick(4), makeId));
    const ex = d.blocks[1]!.exercises;
    expect(ex).toHaveLength(3);
    expect(ex[2]!.sets).toHaveLength(4);
    expect(ex[1]!.sets.every((s) => s.restSeconds === 0)).toBe(true);
    expect(ex[2]!.sets.every((s) => s.restSeconds === 90)).toBe(true);
  });
});

describe('block and exercise removal', () => {
  it('removeBlock drops the block', () => {
    const d = base();
    expect(removeBlock(d, d.blocks[0]!.id).blocks).toHaveLength(1);
  });

  it('moveBlock moves and clamps', () => {
    const d = base();
    const [a, b] = d.blocks;
    expect(moveBlock(d, a!.id, 1).blocks.map((x) => x.id)).toEqual([b!.id, a!.id]);
    expect(moveBlock(d, a!.id, 99).blocks.map((x) => x.id)).toEqual([b!.id, a!.id]);
    expect(moveBlock(d, b!.id, -5).blocks.map((x) => x.id)).toEqual([b!.id, a!.id]);
  });

  it('removeExercise turns a 2-exercise superset into straight with rest 90', () => {
    const d = base();
    const sb = d.blocks[1]!;
    const out = valid(removeExercise(d, sb.id, sb.exercises[1]!.id));
    const nb = out.blocks[1]!;
    expect(nb.kind).toBe('straight');
    expect(nb.exercises).toHaveLength(1);
    expect(nb.exercises[0]!.sets.map((s) => s.restSeconds)).toEqual([90, 90, 90]);
  });

  it('removeExercise from a 3-exercise superset stays a superset', () => {
    let d = base();
    const id = d.blocks[1]!.id;
    d = valid(addExerciseToSuperset(d, id, pick(4), makeId));
    const out = valid(removeExercise(d, id, d.blocks[1]!.exercises[2]!.id));
    expect(out.blocks[1]!.kind).toBe('superset');
    expect(out.blocks[1]!.exercises[1]!.sets.every((s) => s.restSeconds === 90)).toBe(true);
  });

  it('removeExercise on a straight block removes the block', () => {
    const d = base();
    const b = d.blocks[0]!;
    expect(removeExercise(d, b.id, b.exercises[0]!.id).blocks).toHaveLength(1);
  });
});

describe('sets', () => {
  it('addSet appends a normal set copying targets and rest of the last non-drop set', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = updateSet(d, b.id, ex.id, ex.sets[2]!.id, { targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 50, restSeconds: 120 });
    d = addDrop(d, b.id, ex.id, ex.sets[2]!.id, makeId);
    const out = valid(addSet(d, b.id, ex.id, makeId));
    const sets = out.blocks[0]!.exercises[0]!.sets;
    expect(sets).toHaveLength(5);
    expect(sets[4]).toMatchObject({ setType: 'normal', targetRepsMin: 8, targetWeightKg: 50, restSeconds: 120, toFailure: false });
  });

  it('addDrop twice after set 2 gives [n, n, d, d, n]', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = valid(addDrop(d, b.id, ex.id, ex.sets[1]!.id, makeId));
    d = valid(addDrop(d, b.id, ex.id, ex.sets[1]!.id, makeId));
    const sets = d.blocks[0]!.exercises[0]!.sets;
    expect(sets.map((s) => s.setType)).toEqual(['normal', 'normal', 'drop', 'drop', 'normal']);
    expect(sets[2]).toMatchObject({ restSeconds: 0, targetWeightKg: null, targetRepsMin: null });
    expect(sets[4]!.id).toBe(ex.sets[2]!.id);
  });

  it('removeSet removes a middle set; removing a parent removes its drops', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    const [n1, n2, n3] = ex.sets;
    expect(valid(removeSet(d, b.id, ex.id, n2!.id)).blocks[0]!.exercises[0]!.sets.map((s) => s.id)).toEqual([n1!.id, n3!.id]);
    d = addDrop(d, b.id, ex.id, n2!.id, makeId);
    const out = valid(removeSet(d, b.id, ex.id, n2!.id));
    expect(out.blocks[0]!.exercises[0]!.sets.map((s) => s.id)).toEqual([n1!.id, n3!.id]);
  });

  it('removeSet removes a lone drop only', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = addDrop(d, b.id, ex.id, ex.sets[0]!.id, makeId);
    const drop = d.blocks[0]!.exercises[0]!.sets[1]!;
    expect(valid(removeSet(d, b.id, ex.id, drop.id)).blocks[0]!.exercises[0]!.sets).toHaveLength(3);
  });

  it('removeSet is a no-op on the last non-drop set', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = removeSet(d, b.id, ex.id, ex.sets[0]!.id);
    d = removeSet(d, b.id, ex.id, ex.sets[1]!.id);
    const last = d.blocks[0]!.exercises[0]!.sets[0]!;
    const out = removeSet(d, b.id, ex.id, last.id);
    expect(out.blocks[0]!.exercises[0]!.sets).toHaveLength(1);
  });

  it('updateSet patches only that set', () => {
    const d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    const out = valid(updateSet(d, b.id, ex.id, ex.sets[1]!.id, { targetRepsMin: 5, note: 'slow' }));
    const sets = out.blocks[0]!.exercises[0]!.sets;
    expect(sets[1]).toMatchObject({ targetRepsMin: 5, note: 'slow', id: ex.sets[1]!.id });
    expect(sets[0]!.targetRepsMin).toBeNull();
  });
});

describe('rounds', () => {
  it('addRound on a 2x3 superset gives each exercise 4 sets, rest 90 on the last only', () => {
    const d = base();
    const out = valid(addRound(d, d.blocks[1]!.id, makeId));
    const [a, b] = out.blocks[1]!.exercises;
    expect(nonDrop(a!.sets)).toHaveLength(4);
    expect(nonDrop(b!.sets)).toHaveLength(4);
    expect(a!.sets.every((s) => s.restSeconds === 0)).toBe(true);
    expect(b!.sets.every((s) => s.restSeconds === 90)).toBe(true);
  });

  it('removeRound removes the last round (and its drops) from every exercise', () => {
    let d = base();
    const sb = d.blocks[1]!;
    d = addDrop(d, sb.id, sb.exercises[0]!.id, sb.exercises[0]!.sets[2]!.id, makeId);
    const out = valid(removeRound(d, sb.id));
    for (const e of out.blocks[1]!.exercises) expect(e.sets).toHaveLength(2);
  });

  it('removeRound is a no-op at one round; round ops ignore straight blocks', () => {
    let d = base();
    const sb = d.blocks[1]!;
    d = removeRound(removeRound(d, sb.id), sb.id);
    expect(removeRound(d, sb.id)).toEqual(d);
    const straight = d.blocks[0]!;
    expect(addRound(d, straight.id, makeId)).toEqual(d);
    expect(removeRound(d, straight.id)).toEqual(d);
  });
});

describe('replaceExercise', () => {
  it('weight_reps to time nulls weight and reps', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = updateSet(d, b.id, ex.id, ex.sets[0]!.id, { targetRepsMin: 5, targetRepsMax: 8, targetWeightKg: 40, targetDurationS: null });
    const out = valid(replaceExercise(d, b.id, ex.id, pick(9, 'time')));
    const e = out.blocks[0]!.exercises[0]!;
    expect(e).toMatchObject({ id: ex.id, exerciseId: ID(9), exerciseName: 'Exercise 9', trackingType: 'time' });
    expect(e.sets[0]).toMatchObject({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: null });
  });

  it('keeps targets that still apply', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = updateSet(d, b.id, ex.id, ex.sets[0]!.id, { targetRepsMin: 5, targetWeightKg: 40 });
    const e = replaceExercise(d, b.id, ex.id, pick(9, 'reps')).blocks[0]!.exercises[0]!;
    expect(e.sets[0]).toMatchObject({ targetRepsMin: 5, targetWeightKg: null });
  });
});

describe('immutability', () => {
  it('no op mutates a deep-frozen input, and outputs stay valid', () => {
    const d = deepFreeze(base());
    const sb = d.blocks[1]!;
    const st = d.blocks[0]!;
    const ex = st.exercises[0]!;
    const withDrop = deepFreeze(addDrop(d, st.id, ex.id, ex.sets[0]!.id, makeId));
    const outs = [
      addStraightBlock(d, pick(7), makeId),
      addSuperset(d, [pick(7), pick(8)], makeId),
      addExerciseToSuperset(d, sb.id, pick(7), makeId),
      removeBlock(d, st.id),
      moveBlock(d, st.id, 1),
      removeExercise(d, sb.id, sb.exercises[1]!.id),
      addSet(d, st.id, ex.id, makeId),
      addRound(d, sb.id, makeId),
      removeRound(d, sb.id),
      withDrop,
      removeSet(withDrop, st.id, ex.id, ex.sets[0]!.id),
      updateSet(d, st.id, ex.id, ex.sets[0]!.id, { targetRepsMin: 3 }),
      replaceExercise(d, st.id, ex.id, pick(9, 'distance')),
    ];
    for (const o of outs) expect(WorkoutDoc.safeParse(o).success).toBe(true);
  });
});

describe('supersets may be uneven', () => {
  it('addSet in a superset adds a set to that exercise only', () => {
    const d = base();
    const sb = d.blocks[1]!;
    const out = valid(addSet(d, sb.id, sb.exercises[0]!.id, makeId));
    const [a, b] = out.blocks[1]!.exercises;
    expect(nonDrop(a!.sets)).toHaveLength(4);
    expect(nonDrop(b!.sets)).toHaveLength(3);
  });

  it('removeSet in a superset removes that set (and its drops) from that exercise only', () => {
    let d = base();
    const sb = d.blocks[1]!;
    const [a, b] = sb.exercises;
    d = addDrop(d, sb.id, a!.id, a!.sets[1]!.id, makeId);
    const out = valid(removeSet(d, sb.id, a!.id, a!.sets[1]!.id));
    const [oa, ob] = out.blocks[1]!.exercises;
    expect(oa!.sets.map((s) => s.id)).toEqual([a!.sets[0]!.id, a!.sets[2]!.id]);
    expect(ob!.sets.map((s) => s.id)).toEqual(b!.sets.map((s) => s.id));
  });

  it('removeSet keeps the last set of an exercise; removing a drop stays local', () => {
    let d = base();
    const sb = d.blocks[1]!;
    const a = sb.exercises[0]!;
    d = addDrop(d, sb.id, a.id, a.sets[0]!.id, makeId);
    const drop = d.blocks[1]!.exercises[0]!.sets[1]!;
    const local = valid(removeSet(d, sb.id, a.id, drop.id));
    expect(local.blocks[1]!.exercises[0]!.sets).toHaveLength(3);
    expect(local.blocks[1]!.exercises[1]!.sets).toHaveLength(3);
    let one = local;
    for (let i = 0; i < 2; i++) one = removeSet(one, sb.id, a.id, one.blocks[1]!.exercises[0]!.sets[0]!.id);
    expect(valid(one).blocks[1]!.exercises[0]!.sets).toHaveLength(1);
    expect(removeSet(one, sb.id, a.id, one.blocks[1]!.exercises[0]!.sets[0]!.id)).toEqual(one);
  });

  it('removeRound still removes the last round from every exercise, even when uneven', () => {
    let d = base();
    const sb = d.blocks[1]!;
    d = addSet(d, sb.id, sb.exercises[0]!.id, makeId);
    const out = valid(removeRound(d, sb.id));
    const [a, b] = out.blocks[1]!.exercises;
    expect(nonDrop(a!.sets)).toHaveLength(3);
    expect(nonDrop(b!.sets)).toHaveLength(2);
  });
});

describe('updateSet validity', () => {
  it('a drop changed to normal clears toFailure', () => {
    let d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    d = addDrop(d, b.id, ex.id, ex.sets[0]!.id, makeId);
    const drop = d.blocks[0]!.exercises[0]!.sets[1]!;
    d = valid(updateSet(d, b.id, ex.id, drop.id, { toFailure: true }));
    expect(d.blocks[0]!.exercises[0]!.sets[1]!.toFailure).toBe(true);
    const out = valid(updateSet(d, b.id, ex.id, drop.id, { setType: 'normal' }));
    expect(out.blocks[0]!.exercises[0]!.sets[1]).toMatchObject({ setType: 'normal', toFailure: false });
  });

  it('refuses to make the first set a drop', () => {
    const d = base();
    const b = d.blocks[0]!;
    const ex = b.exercises[0]!;
    expect(updateSet(d, b.id, ex.id, ex.sets[0]!.id, { setType: 'drop' })).toEqual(d);
  });

  it('in a superset allows turning a set into a drop, because rounds may differ', () => {
    const d = base();
    const sb = d.blocks[1]!;
    const ex = sb.exercises[0]!;
    const out = valid(updateSet(d, sb.id, ex.id, ex.sets[1]!.id, { setType: 'drop' }));
    expect(out.blocks[1]!.exercises[0]!.sets[1]!.setType).toBe('drop');
    const back = valid(updateSet(out, sb.id, ex.id, ex.sets[1]!.id, { setType: 'warmup' }));
    expect(back.blocks[1]!.exercises[0]!.sets[1]!.setType).toBe('warmup');
  });
});

describe('caps', () => {
  it('MAX_SETS: addSet, addRound and addDrop stop at 20', () => {
    let d = base();
    const st = d.blocks[0]!;
    const ex = st.exercises[0]!;
    for (let i = 0; i < 25; i++) d = addSet(d, st.id, ex.id, makeId);
    expect(valid(d).blocks[0]!.exercises[0]!.sets).toHaveLength(20);
    expect(addDrop(d, st.id, ex.id, ex.sets[0]!.id, makeId)).toEqual(d);
    const sb = d.blocks[1]!;
    for (let i = 0; i < 25; i++) d = addRound(d, sb.id, makeId);
    for (const e of valid(d).blocks[1]!.exercises) expect(e.sets).toHaveLength(20);
  });

  it('MAX_EXERCISES: superset stops at 10 exercises', () => {
    let d = base();
    const sb = d.blocks[1]!;
    for (let i = 0; i < 12; i++) d = addExerciseToSuperset(d, sb.id, pick(20 + i), makeId);
    expect(valid(d).blocks[1]!.exercises).toHaveLength(10);
    const many = Array.from({ length: 11 }, (_, i) => pick(40 + i));
    const e = emptyWorkout(makeId, 'A');
    expect(addSuperset(e, many, makeId)).toEqual(e);
  });

  it('blocks stop at 30', () => {
    let d = emptyWorkout(makeId, 'A');
    for (let i = 0; i < 35; i++) d = addStraightBlock(d, pick(1), makeId);
    expect(valid(d).blocks).toHaveLength(30);
    expect(addSuperset(d, [pick(1), pick(2)], makeId)).toEqual(d);
  });
});

describe('sections and pick-one groups', () => {
  const ids = (d: WorkoutDoc) => d.blocks.map((b) => b.id);
  const secs = (d: WorkoutDoc) => d.sections.map((s) => s.name);

  // Warm-Up [w], Resistance Training [r1, r2], Core [c], Finisher [f]
  function sectioned() {
    let d = emptyWorkout(makeId, 'Upper / Core');
    for (const [name, picks] of [
      ['Warm-Up', [10]],
      ['Resistance Training', [11, 12]],
      ['Core', [13]],
      ['Finisher', [14]],
    ] as const) {
      d = addSection(d, name, makeId);
      for (const n of picks) d = addStraightBlock(d, pick(n), makeId);
    }
    return valid(d);
  }

  it('addSection appends, trims, and refuses blank, long names and an 11th section', () => {
    let d = emptyWorkout(makeId, 'X');
    d = addSection(d, '  Core ', makeId);
    expect(secs(d)).toEqual(['Core']);
    expect(addSection(d, '  ', makeId)).toBe(d);
    expect(addSection(d, 'x'.repeat(41), makeId)).toBe(d);
    for (let i = 0; i < 9; i++) d = addSection(d, `S${i}`, makeId);
    expect(d.sections).toHaveLength(10);
    expect(addSection(d, 'More', makeId)).toBe(d);
  });

  it('adds go into the last section and the doc parses', () => {
    let d = emptyWorkout(makeId, 'X');
    d = addStraightBlock(d, pick(1), makeId);
    expect(d.blocks[0]!.sectionId).toBeNull();
    d = addSection(d, 'A', makeId);
    d = addStraightBlock(d, pick(2), makeId);
    d = addSection(d, 'B', makeId);
    d = addSuperset(d, [pick(3), pick(4)], makeId);
    d = addChoice(d, [pick(5), pick(6)], makeId);
    expect(d.blocks.map((b) => b.sectionId)).toEqual([null, d.sections[0]!.id, d.sections[1]!.id, d.sections[1]!.id]);
    expect(() => valid(d)).not.toThrow();
  });

  it('renameSection renames; unknown or blank is refused', () => {
    const d = sectioned();
    expect(renameSection(d, d.sections[2]!.id, ' Abs ').sections[2]!.name).toBe('Abs');
    expect(renameSection(d, d.sections[2]!.id, '')).toBe(d);
    expect(renameSection(d, ID(1), 'Abs')).toBe(d);
  });

  it('removeSection gives its blocks to the section above', () => {
    const d = sectioned();
    const r = removeSection(d, d.sections[2]!.id);
    expect(secs(r)).toEqual(['Warm-Up', 'Resistance Training', 'Finisher']);
    expect(r.blocks[3]!.sectionId).toBe(d.sections[1]!.id);
    expect(() => valid(r)).not.toThrow();
  });

  it('removeSection on the first section leaves its blocks unsectioned at the top', () => {
    const d = sectioned();
    const r = removeSection(d, d.sections[0]!.id);
    expect(r.blocks[0]!.sectionId).toBeNull();
    expect(secs(r)).toEqual(['Resistance Training', 'Core', 'Finisher']);
    expect(() => valid(r)).not.toThrow();
  });

  it('moveSection(+1) on Core swaps it with Finisher, blocks follow', () => {
    const d = sectioned();
    const core = d.sections[2]!.id;
    const r = moveSection(d, core, 1);
    expect(secs(r)).toEqual(['Warm-Up', 'Resistance Training', 'Finisher', 'Core']);
    expect(r.blocks.map((b) => b.exercises[0]!.exerciseId)).toEqual([10, 11, 12, 14, 13].map(ID));
    expect(() => valid(r)).not.toThrow();
    expect(moveSection(d, d.sections[0]!.id, -1)).toBe(d);
    expect(moveSection(d, d.sections[3]!.id, 1)).toBe(d);
    const up = moveSection(d, core, -1);
    expect(secs(up)).toEqual(['Warm-Up', 'Core', 'Resistance Training', 'Finisher']);
    expect(up.blocks.map((b) => b.exercises[0]!.exerciseId)).toEqual([10, 13, 11, 12, 14].map(ID));
  });

  it('moveBlock cannot cross a section heading', () => {
    const d = sectioned();
    const [, r1, r2] = d.blocks;
    expect(ids(moveBlock(d, r2!.id, 0))).toEqual([d.blocks[0]!.id, r2!.id, r1!.id, d.blocks[3]!.id, d.blocks[4]!.id]);
    expect(ids(moveBlock(d, r1!.id, 99))).toEqual([d.blocks[0]!.id, r2!.id, r1!.id, d.blocks[3]!.id, d.blocks[4]!.id]);
    expect(ids(moveBlock(d, r1!.id, 4))).toEqual([d.blocks[0]!.id, r2!.id, r1!.id, d.blocks[3]!.id, d.blocks[4]!.id]);
    expect(() => valid(moveBlock(d, r1!.id, 4))).not.toThrow();
  });

  it('moveBlockToSection puts the block at the end of that section', () => {
    const d = sectioned();
    const r = moveBlockToSection(d, d.blocks[0]!.id, d.sections[2]!.id);
    // Warm-Up became empty, so it goes away.
    expect(secs(r)).toEqual(['Resistance Training', 'Core', 'Finisher']);
    expect(r.blocks.map((b) => b.exercises[0]!.exerciseId)).toEqual([11, 12, 13, 10, 14].map(ID));
    expect(() => valid(r)).not.toThrow();
    const toTop = moveBlockToSection(d, d.blocks[3]!.id, null);
    expect(toTop.blocks[0]!.id).toBe(d.blocks[3]!.id);
    expect(toTop.blocks[0]!.sectionId).toBeNull();
    expect(() => valid(toTop)).not.toThrow();
    expect(moveBlockToSection(d, d.blocks[0]!.id, ID(1))).toBe(d);
  });

  it('moveBlockToSection(null) lands after an unsectioned block that already exists', () => {
    let d = emptyWorkout(makeId, 'X');
    d = addStraightBlock(d, pick(1), makeId);
    d = addSection(d, 'A', makeId);
    d = addStraightBlock(d, pick(2), makeId);
    d = addStraightBlock(d, pick(3), makeId);
    const r = moveBlockToSection(d, d.blocks[2]!.id, null);
    expect(r.blocks.map((b) => b.exercises[0]!.exerciseId)).toEqual([1, 3, 2].map(ID));
    expect(r.blocks.map((b) => b.sectionId)).toEqual([null, null, d.sections[0]!.id]);
    expect(() => valid(r)).not.toThrow();
  });

  it('removeSection on a freshly added empty section only drops the heading', () => {
    const d = addSection(sectioned(), 'New', makeId);
    const r = removeSection(d, d.sections[4]!.id);
    expect(secs(r)).toEqual(secs(sectioned()));
    expect(ids(r)).toEqual(ids(d));
    expect(() => valid(r)).not.toThrow();
  });

  it('removeBlock removes a section when its last block goes, and keeps it otherwise', () => {
    const d = sectioned();
    const r = removeBlock(d, d.blocks[0]!.id);
    expect(secs(r)).toEqual(['Resistance Training', 'Core', 'Finisher']);
    expect(secs(removeBlock(d, d.blocks[1]!.id))).toEqual(secs(d));
    expect(() => valid(r)).not.toThrow();
    // A freshly added empty section is not removed by removing someone else's block.
    const withEmpty = addSection(d, 'New', makeId);
    expect(secs(removeBlock(withEmpty, d.blocks[0]!.id))).toContain('New');
  });

  it('addChoice makes 2-5 options with 3 normal sets each, and refuses otherwise', () => {
    const d = emptyWorkout(makeId, 'X');
    const c = addChoice(d, [pick(1), pick(2), pick(3)], makeId);
    expect(c.blocks[0]!.kind).toBe('choice');
    expect(c.blocks[0]!.exercises.map((e) => e.sets.length)).toEqual([3, 3, 3]);
    expect(c.blocks[0]!.exercises[0]!.sets.every((s) => s.setType === 'normal' && s.restSeconds === 90)).toBe(true);
    expect(addChoice(d, [pick(1)], makeId)).toBe(d);
    expect(addChoice(d, [1, 2, 3, 4, 5, 6].map((n) => pick(n)), makeId)).toBe(d);
    expect(() => valid(c)).not.toThrow();
  });

  it('addChoiceOption adds until 5 and refuses non-choice blocks', () => {
    let d = addChoice(emptyWorkout(makeId, 'X'), [pick(1), pick(2)], makeId);
    const id = d.blocks[0]!.id;
    for (const n of [3, 4, 5]) d = addChoiceOption(d, id, pick(n), makeId);
    expect(d.blocks[0]!.exercises).toHaveLength(5);
    expect(d.blocks[0]!.exercises[4]!.sets).toHaveLength(3);
    expect(addChoiceOption(d, id, pick(6), makeId)).toBe(d);
    const b = base();
    expect(addChoiceOption(b, b.blocks[0]!.id, pick(9), makeId)).toBe(b);
  });

  it('removeExercise on a two-option choice becomes straight and keeps the other option', () => {
    const d = addChoice(emptyWorkout(makeId, 'X'), [pick(1), pick(2)], makeId);
    const b = d.blocks[0]!;
    const r = removeExercise(d, b.id, b.exercises[1]!.id);
    expect(r.blocks[0]!.kind).toBe('straight');
    expect(r.blocks[0]!.exercises[0]).toEqual(b.exercises[0]);
  });

  it('removeExercise on a choice never moves rest to another option', () => {
    let d = addChoice(emptyWorkout(makeId, 'X'), [pick(1), pick(2), pick(3)], makeId);
    const b = d.blocks[0]!;
    d = updateSet(d, b.id, b.exercises[1]!.id, b.exercises[1]!.sets[0]!.id, { restSeconds: 30 });
    d = updateSet(d, b.id, b.exercises[2]!.id, b.exercises[2]!.sets[0]!.id, { restSeconds: 45 });
    const r = removeExercise(d, b.id, b.exercises[2]!.id);
    expect(r.blocks[0]!.kind).toBe('choice');
    expect(r.blocks[0]!.exercises[1]!.sets.map((s) => s.restSeconds)).toEqual([30, 90, 90]);
  });

  it('addRound and removeRound refuse choice blocks', () => {
    const d = addChoice(emptyWorkout(makeId, 'X'), [pick(1), pick(2)], makeId);
    expect(addRound(d, d.blocks[0]!.id, makeId).blocks[0]!.exercises[0]!.sets).toHaveLength(3);
    expect(removeRound(d, d.blocks[0]!.id).blocks[0]!.exercises[0]!.sets).toHaveLength(3);
  });
});
