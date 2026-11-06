import { describe, expect, it } from 'vitest';
import {
  addChoice,
  addDrop,
  addRound,
  addSet,
  addStraightBlock,
  addStraightBlocks,
  addSuperset,
  copyFirstSetToAll,
  emptyWorkout,
  fillDown,
  hasTargets,
  updateSet,
} from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 5000;
const makeId = () => ID(++counter);
const pick = (n: number, trackingType: ExercisePick['trackingType'] = 'weight_reps'): ExercisePick => ({
  id: ID(n),
  name: `Exercise ${n}`,
  trackingType,
});
const valid = (d: unknown) => WorkoutDoc.parse(d);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

/** A straight block of 4 sets: [warm-up, 1, 2 (+ drop), 3]. Set 1 is 8-10 reps at 60 kg, 120 s rest, with a note. */
function straight() {
  let d = addStraightBlock(emptyWorkout(makeId, 'W'), pick(1), makeId, 4);
  const b = d.blocks[0]!;
  const e = b.exercises[0]!;
  const [w, s1, s2] = e.sets;
  d = updateSet(d, b.id, e.id, w!.id, { setType: 'warmup', targetRepsMin: 15, targetRepsMax: 15, targetWeightKg: 20 });
  d = updateSet(d, b.id, e.id, s1!.id, { targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 60, restSeconds: 120, note: 'slow' });
  d = addDrop(d, b.id, e.id, s2!.id, makeId);
  const drop = d.blocks[0]!.exercises[0]!.sets[3]!;
  d = updateSet(d, b.id, e.id, drop.id, { targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 40, toFailure: true });
  return { d: valid(d), blockId: b.id, exId: e.id, s1Id: s1!.id, s2Id: s2!.id };
}

describe('copyFirstSetToAll', () => {
  it('copies set 1 targets and rest to every later normal set', () => {
    const { d, blockId, exId } = straight();
    const out = copyFirstSetToAll(d, blockId, exId);
    const sets = out.blocks[0]!.exercises[0]!.sets;
    const normals = sets.filter((s) => s.setType === 'normal');
    expect(normals).toHaveLength(3);
    for (const s of normals) {
      expect([s.targetRepsMin, s.targetRepsMax, s.targetWeightKg, s.restSeconds]).toEqual([8, 10, 60, 120]);
    }
    expect(valid(out)).toBeTruthy();
  });

  it('leaves warm-ups, drops, notes, set types and ids alone', () => {
    const { d, blockId, exId } = straight();
    const before = d.blocks[0]!.exercises[0]!.sets;
    const after = copyFirstSetToAll(d, blockId, exId).blocks[0]!.exercises[0]!.sets;
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(after.map((s) => s.setType)).toEqual(before.map((s) => s.setType));
    expect(after[0]).toEqual(before[0]); // warm-up
    expect(after[3]).toEqual(before[3]); // drop
    expect(after.filter((s) => s.setType === 'normal').slice(1).map((s) => s.note)).toEqual([null, null]);
  });

  it('does nothing while set 1 has no targets, so typed sets are never wiped', () => {
    let d = addStraightBlock(emptyWorkout(makeId, 'W'), pick(1), makeId, 3);
    const b = d.blocks[0]!;
    const e = b.exercises[0]!;
    d = updateSet(d, b.id, e.id, e.sets[2]!.id, { targetRepsMin: 5, targetRepsMax: 5 });
    expect(hasTargets(d.blocks[0]!.exercises[0]!.sets[0]!)).toBe(false);
    expect(copyFirstSetToAll(d, b.id, e.id)).toBe(d);
    expect(fillDown(d, b.id, e.id, e.sets[1]!.id)).toBe(d);
  });

  it('copies a blank field along with the filled ones (set 1 decides every main set)', () => {
    let d = addStraightBlock(emptyWorkout(makeId, 'W'), pick(1), makeId, 2);
    const b = d.blocks[0]!;
    const e = b.exercises[0]!;
    d = updateSet(d, b.id, e.id, e.sets[0]!.id, { targetRepsMin: 8, targetRepsMax: 8 });
    d = updateSet(d, b.id, e.id, e.sets[1]!.id, { targetWeightKg: 50 });
    const out = copyFirstSetToAll(d, b.id, e.id).blocks[0]!.exercises[0]!.sets[1]!;
    expect([out.targetRepsMin, out.targetWeightKg]).toEqual([8, null]);
  });

  it('is a no-op (same object) on an unknown exercise or one with a single main set', () => {
    const { d, blockId } = straight();
    expect(copyFirstSetToAll(d, blockId, ID(1))).toBe(d);
    const one = addStraightBlock(emptyWorkout(makeId, 'W'), pick(1), makeId, 1);
    expect(copyFirstSetToAll(one, one.blocks[0]!.id, one.blocks[0]!.exercises[0]!.id)).toEqual(one);
  });

  it('does not mutate a frozen doc', () => {
    const { d, blockId, exId } = straight();
    expect(() => copyFirstSetToAll(deepFreeze(d), blockId, exId)).not.toThrow();
  });

  it('copies time and distance targets for those exercises', () => {
    let t = addStraightBlock(emptyWorkout(makeId, 'W'), pick(9, 'time'), makeId, 3);
    const tb = t.blocks[0]!;
    t = updateSet(t, tb.id, tb.exercises[0]!.id, tb.exercises[0]!.sets[0]!.id, { targetDurationS: 300 });
    t = copyFirstSetToAll(t, tb.id, tb.exercises[0]!.id);
    expect(t.blocks[0]!.exercises[0]!.sets.map((s) => s.targetDurationS)).toEqual([300, 300, 300]);
    expect(valid(t)).toBeTruthy();

    let m = addStraightBlock(emptyWorkout(makeId, 'W'), pick(9, 'distance'), makeId, 3);
    const mb = m.blocks[0]!;
    m = updateSet(m, mb.id, mb.exercises[0]!.id, mb.exercises[0]!.sets[0]!.id, { targetDistanceM: 1000 });
    m = copyFirstSetToAll(m, mb.id, mb.exercises[0]!.id);
    expect(m.blocks[0]!.exercises[0]!.sets.map((s) => s.targetDistanceM)).toEqual([1000, 1000, 1000]);
    expect(valid(m)).toBeTruthy();
  });
});

describe('fillDown', () => {
  it('copies one set to the main sets below it only', () => {
    const { d: base, blockId, exId, s2Id } = straight();
    const d = updateSet(base, blockId, exId, s2Id, { targetRepsMin: 6, targetRepsMax: 6, targetWeightKg: 70, restSeconds: 150 });
    const out = fillDown(d, blockId, exId, s2Id);
    const normals = out.blocks[0]!.exercises[0]!.sets.filter((s) => s.setType === 'normal');
    expect(normals.map((s) => [s.targetRepsMin, s.targetWeightKg, s.restSeconds])).toEqual([
      [8, 60, 120],
      [6, 70, 150],
      [6, 70, 150],
    ]);
    expect(valid(out)).toBeTruthy();
  });

  it('refuses to fill from a warm-up or a drop', () => {
    const { d, blockId, exId } = straight();
    const sets = d.blocks[0]!.exercises[0]!.sets;
    expect(fillDown(d, blockId, exId, sets[0]!.id)).toBe(d);
    expect(fillDown(d, blockId, exId, sets[3]!.id)).toBe(d);
  });

  it('from the last main set changes nothing', () => {
    const { d, blockId, exId } = straight();
    const sets = d.blocks[0]!.exercises[0]!.sets;
    expect(fillDown(d, blockId, exId, sets[4]!.id)).toEqual(d);
  });
});

describe('copy to all sets in a superset', () => {
  it('copies rest on the last exercise, and keeps the round-goes-straight-on zeros elsewhere', () => {
    let d = addSuperset(emptyWorkout(makeId, 'W'), [pick(1), pick(2)], makeId, 3);
    const b = d.blocks[0]!;
    const [a, z] = b.exercises;
    d = updateSet(d, b.id, a!.id, a!.sets[0]!.id, { targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 30 });
    d = updateSet(d, b.id, z!.id, z!.sets[0]!.id, { targetRepsMin: 12, targetRepsMax: 12, restSeconds: 60 });
    d = copyFirstSetToAll(d, b.id, a!.id);
    d = copyFirstSetToAll(d, b.id, z!.id);
    const [ea, ez] = d.blocks[0]!.exercises;
    expect(ea!.sets.map((s) => [s.targetRepsMin, s.targetWeightKg, s.restSeconds])).toEqual([
      [10, 30, 0],
      [10, 30, 0],
      [10, 30, 0],
    ]);
    expect(ez!.sets.map((s) => [s.targetRepsMin, s.restSeconds])).toEqual([
      [12, 60],
      [12, 60],
      [12, 60],
    ]);
    expect(valid(d)).toBeTruthy();
  });

  it('uneven rounds: a longer non-last exercise keeps the rest on its extra rounds', () => {
    let d = addSuperset(emptyWorkout(makeId, 'W'), [pick(1), pick(2)], makeId, 3);
    const b = d.blocks[0]!;
    const a = b.exercises[0]!;
    d = addSet(d, b.id, a.id, makeId); // A has 4 sets, B 3: A's set 4 rests (rest 90)
    d = updateSet(d, b.id, a.id, a.sets[0]!.id, { targetRepsMin: 5, targetRepsMax: 5 });
    const out = copyFirstSetToAll(d, b.id, a.id);
    const sets = out.blocks[0]!.exercises[0]!.sets;
    expect(sets.map((s) => s.targetRepsMin)).toEqual([5, 5, 5, 5]);
    expect(sets.map((s) => s.restSeconds)).toEqual([0, 0, 0, 90]);
    // The other exercise is untouched.
    expect(out.blocks[0]!.exercises[1]).toBe(d.blocks[0]!.exercises[1]);
  });

  it('uneven rounds the other way: the last exercise copies only to its own sets', () => {
    let d = addSuperset(emptyWorkout(makeId, 'W'), [pick(1), pick(2)], makeId, 2);
    d = addRound(d, d.blocks[0]!.id, makeId);
    const b = d.blocks[0]!;
    const z = b.exercises[1]!;
    d = addSet(d, b.id, z.id, makeId);
    d = updateSet(d, b.id, z.id, z.sets[0]!.id, { targetWeightKg: 50, restSeconds: 75 });
    const out = copyFirstSetToAll(d, b.id, z.id);
    expect(out.blocks[0]!.exercises[1]!.sets.map((s) => [s.targetWeightKg, s.restSeconds])).toEqual([
      [50, 75],
      [50, 75],
      [50, 75],
      [50, 75],
    ]);
    expect(out.blocks[0]!.exercises[0]).toBe(d.blocks[0]!.exercises[0]);
  });
});

describe('copy to all sets in a pick-one group', () => {
  it('changes only the option it was used on', () => {
    let d = addChoice(emptyWorkout(makeId, 'W'), [pick(1), pick(2)], makeId, 3);
    const b = d.blocks[0]!;
    const [o1] = b.exercises;
    d = updateSet(d, b.id, o1!.id, o1!.sets[0]!.id, { targetRepsMin: 8, targetRepsMax: 8, targetWeightKg: 100 });
    const out = copyFirstSetToAll(d, b.id, o1!.id);
    expect(out.blocks[0]!.exercises[0]!.sets.map((s) => s.targetWeightKg)).toEqual([100, 100, 100]);
    expect(out.blocks[0]!.exercises[1]).toBe(d.blocks[0]!.exercises[1]);
    expect(valid(out)).toBeTruthy();
  });
});

describe('set counts when adding', () => {
  it('addStraightBlock, addSuperset and addChoice take a set count (default 3), clamped to 1-20', () => {
    const e = emptyWorkout(makeId, 'W');
    expect(addStraightBlock(e, pick(1), makeId).blocks[0]!.exercises[0]!.sets).toHaveLength(3);
    expect(addStraightBlock(e, pick(1), makeId, 5).blocks[0]!.exercises[0]!.sets).toHaveLength(5);
    expect(addStraightBlock(e, pick(1), makeId, 0).blocks[0]!.exercises[0]!.sets).toHaveLength(1);
    expect(addStraightBlock(e, pick(1), makeId, 99).blocks[0]!.exercises[0]!.sets).toHaveLength(20);
    expect(addStraightBlock(e, pick(1), makeId, 2.6).blocks[0]!.exercises[0]!.sets).toHaveLength(3);
    const ss = addSuperset(e, [pick(1), pick(2)], makeId, 4).blocks[0]!;
    expect(ss.exercises.map((x) => x.sets.length)).toEqual([4, 4]);
    expect(ss.exercises.map((x) => x.sets[0]!.restSeconds)).toEqual([0, 90]);
    expect(addChoice(e, [pick(1), pick(2)], makeId, 2).blocks[0]!.exercises.map((x) => x.sets.length)).toEqual([2, 2]);
  });
});

describe('addStraightBlocks', () => {
  it('adds each pick as its own straight block, in pick order', () => {
    const d = addStraightBlocks(emptyWorkout(makeId, 'W'), [pick(3), pick(1), pick(2)], makeId, 4);
    expect(d.blocks.map((b) => b.kind)).toEqual(['straight', 'straight', 'straight']);
    expect(d.blocks.map((b) => b.exercises[0]!.exerciseName)).toEqual(['Exercise 3', 'Exercise 1', 'Exercise 2']);
    expect(d.blocks.every((b) => b.exercises[0]!.sets.length === 4)).toBe(true);
    expect(new Set(d.blocks.map((b) => b.id)).size).toBe(3);
    expect(valid(d)).toBeTruthy();
  });

  it('stops at the 30-block cap', () => {
    let d = emptyWorkout(makeId, 'W');
    for (let i = 0; i < 28; i += 1) d = addStraightBlock(d, pick(1), makeId);
    d = addStraightBlocks(d, [pick(1), pick(2), pick(3)], makeId);
    expect(d.blocks).toHaveLength(30);
    expect(d.blocks[29]!.exercises[0]!.exerciseName).toBe('Exercise 2');
  });

  it('with no picks returns the same doc', () => {
    const d = emptyWorkout(makeId, 'W');
    expect(addStraightBlocks(d, [], makeId)).toBe(d);
  });
});
