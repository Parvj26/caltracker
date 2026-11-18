import { describe, expect, it } from 'vitest';
import {
  addChoice,
  addSection,
  addSet,
  addStraightBlock,
  addSubstitute,
  addSuperset,
  canJoinWithNext,
  emptyWorkout,
  exerciseRestOff,
  joinWithNext,
  keepRestOff,
  reorderBlocks,
  setExerciseRest,
  splitSuperset,
  updateSet,
} from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 5000;
const makeId = () => ID(++counter);
const pick = (n: number): ExercisePick => ({ id: ID(n), name: `Exercise ${n}`, trackingType: 'weight_reps' });
const valid = (d: unknown) => WorkoutDoc.parse(d);
const rests = (d: WorkoutDoc, bi: number, ei: number) => d.blocks[bi]!.exercises[ei]!.sets.map((s) => s.restSeconds);

function straights(...sets: number[]) {
  let d = emptyWorkout(makeId, 'W');
  sets.forEach((n, i) => (d = addStraightBlock(d, pick(i + 1), makeId, n)));
  return valid(d);
}

describe('joinWithNext', () => {
  it('joins two straight exercises into a superset; the first goes straight on where the second has a set', () => {
    const d = straights(3, 1);
    const out = valid(joinWithNext(d, d.blocks[0]!.id, makeId));
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]!.kind).toBe('superset');
    expect(out.blocks[0]!.id).toBe(d.blocks[0]!.id);
    expect(out.blocks[0]!.exercises[0]!.id).toBe(d.blocks[0]!.exercises[0]!.id);
    expect(out.blocks[0]!.exercises[1]!.id).not.toBe(d.blocks[1]!.exercises[0]!.id);
    expect(rests(out, 0, 0)).toEqual([0, 90, 90]);
    expect(rests(out, 0, 1)).toEqual([90]);
  });

  it('chains: joining a superset with the next exercise makes one superset of three', () => {
    let d = straights(2, 2, 2);
    d = joinWithNext(d, d.blocks[0]!.id, makeId);
    d = valid(joinWithNext(d, d.blocks[0]!.id, makeId));
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]!.exercises.map((e) => e.exerciseName)).toEqual(['Exercise 1', 'Exercise 2', 'Exercise 3']);
    expect([rests(d, 0, 0), rests(d, 0, 1), rests(d, 0, 2)]).toEqual([[0, 0], [0, 0], [90, 90]]);
  });

  it('joins a straight exercise onto the start of a superset below', () => {
    let d = straights(1, 2, 2);
    d = joinWithNext(d, d.blocks[1]!.id, makeId);
    d = valid(joinWithNext(d, d.blocks[0]!.id, makeId));
    expect(d.blocks[0]!.exercises).toHaveLength(3);
  });

  it('gives a substitute the same rest rule as its exercise', () => {
    let d = straights(2, 2);
    d = addSubstitute(d, d.blocks[0]!.id, d.blocks[0]!.exercises[0]!.id, pick(9), makeId);
    d = valid(joinWithNext(d, d.blocks[0]!.id, makeId));
    expect(d.blocks[0]!.exercises[0]!.substitutes[0]!.sets.map((s) => s.restSeconds)).toEqual([0, 0]);
  });

  it('refuses across a section boundary, next to a pick-one group, past 10 exercises, or at the last block', () => {
    let d = straights(1);
    d = addSection(d, 'Main', makeId);
    d = addStraightBlock(d, pick(2), makeId);
    expect(canJoinWithNext(d, d.blocks[0]!.id)).toBe(false);
    expect(joinWithNext(d, d.blocks[0]!.id, makeId)).toBe(d);
    expect(canJoinWithNext(d, d.blocks[1]!.id)).toBe(false);

    let c = straights(1);
    c = addChoice(c, [pick(2), pick(3)], makeId);
    expect(canJoinWithNext(c, c.blocks[0]!.id)).toBe(false);

    let big = emptyWorkout(makeId, 'W');
    big = addSuperset(big, Array.from({ length: 9 }, (_, i) => pick(i + 1)), makeId);
    big = addSuperset(big, [pick(20), pick(21)], makeId);
    expect(canJoinWithNext(big, big.blocks[0]!.id)).toBe(false);
  });
});

describe('splitSuperset', () => {
  it('splits a two-exercise superset back into straight exercises, giving the first its round rest', () => {
    let d = straights(3, 3);
    d = joinWithNext(d, d.blocks[0]!.id, makeId);
    d = updateSet(d, d.blocks[0]!.id, d.blocks[0]!.exercises[1]!.id, d.blocks[0]!.exercises[1]!.sets[1]!.id, { restSeconds: 120 });
    const out = valid(splitSuperset(d, d.blocks[0]!.id, 1, makeId));
    expect(out.blocks.map((b) => b.kind)).toEqual(['straight', 'straight']);
    expect(rests(out, 0, 0)).toEqual([90, 120, 90]);
    expect(rests(out, 1, 0)).toEqual([90, 120, 90]);
    expect(out.blocks[1]!.sectionId).toBe(d.blocks[0]!.sectionId);
    // The exercise that moved to a new block is saved as a new row.
    const moved = d.blocks[0]!.exercises[1]!;
    expect(out.blocks[1]!.exercises[0]!.id).not.toBe(moved.id);
    expect(out.blocks[1]!.exercises[0]!.sets.map((s) => s.id)).not.toContain(moved.sets[0]!.id);
  });

  it('splits a superset of three in the middle, keeping the rest rule in the part left a superset', () => {
    let d = straights(3, 1, 3);
    d = joinWithNext(d, d.blocks[0]!.id, makeId);
    d = joinWithNext(d, d.blocks[0]!.id, makeId);
    const out = valid(splitSuperset(d, d.blocks[0]!.id, 2, makeId));
    expect(out.blocks.map((b) => b.kind)).toEqual(['superset', 'straight']);
    // Exercise 1's rounds 2 and 3 went on to exercise 3; now no later exercise has them, so they rest.
    expect(rests(out, 0, 0)).toEqual([0, 90, 90]);
    expect(rests(out, 0, 1)).toEqual([90]);
  });

  it('refuses a straight block, a bad place, or a workout at the 30-block cap', () => {
    const d = straights(1, 1);
    expect(splitSuperset(d, d.blocks[0]!.id, 1, makeId)).toBe(d);
    const s = joinWithNext(d, d.blocks[0]!.id, makeId);
    expect(splitSuperset(s, s.blocks[0]!.id, 0, makeId)).toBe(s);
    expect(splitSuperset(s, s.blocks[0]!.id, 2, makeId)).toBe(s);
    let full = straights(...Array.from({ length: 30 }, () => 1));
    full = joinWithNext(full, full.blocks[0]!.id, makeId);
    full = addStraightBlock(full, pick(99), makeId);
    expect(full.blocks).toHaveLength(30);
    expect(splitSuperset(full, full.blocks[0]!.id, 1, makeId)).toBe(full);
  });
});

describe('reorderBlocks', () => {
  it('puts the blocks in the given order', () => {
    const d = straights(1, 1, 1);
    const ids = d.blocks.map((b) => b.id);
    const out = valid(reorderBlocks(d, [ids[2]!, ids[0]!, ids[1]!]));
    expect(out.blocks.map((b) => b.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('keeps each block in its own section', () => {
    let d = straights(1);
    d = addSection(d, 'Main', makeId);
    d = addStraightBlock(d, pick(2), makeId);
    const [a, b] = d.blocks.map((x) => x.id);
    expect(reorderBlocks(d, [b!, a!]).blocks.map((x) => x.id)).toEqual([a, b]);
  });

  it('refuses a list that is not exactly the blocks', () => {
    const d = straights(1, 1);
    expect(reorderBlocks(d, [d.blocks[0]!.id])).toBe(d);
    expect(reorderBlocks(d, [d.blocks[0]!.id, d.blocks[0]!.id])).toBe(d);
    expect(reorderBlocks(d, [d.blocks[0]!.id, ID(1)])).toBe(d);
  });
});

describe('Rest checkbox', () => {
  it('off sets every rest to 0 and reads back as off; on gives the default 1:30 back', () => {
    let d = straights(2);
    const [b, e] = [d.blocks[0]!.id, d.blocks[0]!.exercises[0]!.id];
    expect(exerciseRestOff(d.blocks[0]!, 0)).toBe(false);
    d = valid(setExerciseRest(d, b, e, false));
    expect(rests(d, 0, 0)).toEqual([0, 0]);
    expect(exerciseRestOff(d.blocks[0]!, 0)).toBe(true);
    d = valid(setExerciseRest(d, b, e, true));
    expect(rests(d, 0, 0)).toEqual([90, 90]);
  });

  it('on gives rest only where a rest box shows: in a superset, the last exercise of each round', () => {
    let d = straights(2, 2);
    d = joinWithNext(d, d.blocks[0]!.id, makeId);
    const blk = d.blocks[0]!;
    expect(exerciseRestOff(blk, 0)).toBeNull();
    d = setExerciseRest(d, blk.id, blk.exercises[1]!.id, false);
    expect(exerciseRestOff(d.blocks[0]!, 1)).toBe(true);
    d = setExerciseRest(d, blk.id, blk.exercises[0]!.id, true);
    expect(rests(d, 0, 0)).toEqual([0, 0]);
  });

  it('keepRestOff zeroes a rest an edit gave an exercise whose Rest is off, and is a no-op otherwise', () => {
    let d = straights(1, 2);
    d = joinWithNext(d, d.blocks[0]!.id, makeId);
    const first = d.blocks[0]!.exercises[0]!.id;
    const grown = addSet(d, d.blocks[0]!.id, first, makeId);
    expect(rests(grown, 0, 0)).toEqual([0, 0]);
    d = setExerciseRest(d, d.blocks[0]!.id, d.blocks[0]!.exercises[1]!.id, true);
    const split = splitSuperset(d, d.blocks[0]!.id, 1, makeId);
    expect(rests(split, 0, 0)).toEqual([90]);
    expect(rests(keepRestOff(split, new Set([first])), 0, 0)).toEqual([0]);
    expect(keepRestOff(split, new Set())).toBe(split);
    expect(keepRestOff(split, new Set([ID(1)]))).toBe(split);
  });
});
