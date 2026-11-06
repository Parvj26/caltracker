import { describe, expect, it } from 'vitest';
import {
  addDrop,
  addExerciseToSuperset,
  addRound,
  addSet,
  addStraightBlock,
  addSuperset,
  emptyWorkout,
  moveBlock,
  removeBlock,
  removeExercise,
  removeRound,
  removeSet,
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
