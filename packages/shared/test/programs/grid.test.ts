import { describe, expect, it } from 'vitest';
import { copySlotTo, copyWeek, followingWeeks, slotsInWeeks } from '../../src/programs/grid';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 9000;
const makeId = () => ID(++counter);

type S = { id: string; week: number; day: number; position: number; workoutId: string; workoutName: string };
const slot = (n: number, week: number, day: number, position = 0): S => ({
  id: ID(n),
  week,
  day,
  position,
  workoutId: ID(100 + n),
  workoutName: `W${n}`,
});

// Week 1: day 1 (two workouts), day 3. Week 2: day 5. Week 3: empty. Week 4: day 2.
const plan = [slot(1, 1, 1, 0), slot(2, 1, 1, 1), slot(3, 1, 3), slot(4, 2, 5), slot(5, 4, 2)];

describe('followingWeeks', () => {
  it('lists the weeks after one, up to the program length', () => {
    expect(followingWeeks(2, 5)).toEqual([3, 4, 5]);
    expect(followingWeeks(5, 5)).toEqual([]);
  });
});

describe('slotsInWeeks', () => {
  it('counts what a copy would replace', () => {
    expect(slotsInWeeks(plan, [2, 3, 4])).toBe(2);
    expect(slotsInWeeks(plan, [3])).toBe(0);
  });
});

describe('copyWeek', () => {
  it('replaces the target week with a copy of the source week (same days and order, new ids)', () => {
    const out = copyWeek(plan, { from: 1, to: [2], weeks: 4 }, makeId);
    expect(out.removed.map((s) => s.id)).toEqual([ID(4)]);
    expect(out.added.map((s) => [s.week, s.day, s.position, s.workoutId, s.workoutName])).toEqual([
      [2, 1, 0, ID(101), 'W1'],
      [2, 1, 1, ID(102), 'W2'],
      [2, 3, 0, ID(103), 'W3'],
    ]);
    expect(out.added.every((s) => !plan.some((p) => p.id === s.id))).toBe(true);
    // Other weeks and the source week are untouched.
    expect(out.slots.filter((s) => s.week !== 2)).toEqual(plan.filter((s) => s.week !== 2));
    expect(out.slots.filter((s) => s.week === 2)).toEqual(out.added);
  });

  it('repeats a week for every following week', () => {
    const out = copyWeek(plan, { from: 1, to: followingWeeks(1, 4), weeks: 4 }, makeId);
    for (const w of [2, 3, 4]) {
      expect(out.slots.filter((s) => s.week === w).map((s) => [s.day, s.workoutId])).toEqual([
        [1, ID(101)],
        [1, ID(102)],
        [3, ID(103)],
      ]);
    }
    expect(out.removed.map((s) => s.id).sort()).toEqual([ID(4), ID(5)]);
    expect(out.added).toHaveLength(9);
  });

  it('ignores the source week, repeats and weeks outside the program', () => {
    const out = copyWeek(plan, { from: 1, to: [1, 3, 3, 0, 9], weeks: 4 }, makeId);
    expect(out.weeks).toEqual([3]);
    expect(out.added.map((s) => s.week)).toEqual([3, 3, 3]);
    expect(out.slots.filter((s) => s.week === 1)).toEqual(plan.filter((s) => s.week === 1));
  });

  it('copying an empty week empties the target', () => {
    const out = copyWeek(plan, { from: 3, to: [2], weeks: 4 }, makeId);
    expect(out.added).toEqual([]);
    expect(out.slots.some((s) => s.week === 2)).toBe(false);
  });

  it('orders the copies by target week, then day, position and id (the order copy_program_week assigns ids in)', () => {
    const tie = [
      { ...slot(1, 1, 2, 0), id: 'b0000000-0000-4000-8000-000000000000' },
      { ...slot(2, 1, 2, 0), id: 'a0000000-0000-4000-8000-000000000000' },
      slot(3, 1, 1, 1),
      slot(4, 1, 1, 0),
    ];
    const out = copyWeek(tie, { from: 1, to: [3, 2], weeks: 3 }, makeId);
    expect(out.added.map((s) => [s.week, s.workoutId])).toEqual([
      [2, ID(104)],
      [2, ID(103)],
      [2, ID(102)],
      [2, ID(101)],
      [3, ID(104)],
      [3, ID(103)],
      [3, ID(102)],
      [3, ID(101)],
    ]);
  });

  it('does not change the input', () => {
    const frozen = Object.freeze(plan.map((s) => Object.freeze({ ...s })));
    expect(() => copyWeek(frozen, { from: 1, to: [2], weeks: 4 }, makeId)).not.toThrow();
  });
});

describe('copySlotTo', () => {
  it('puts the same workout on each chosen day, last in that day, with new ids', () => {
    const source = plan[2]!; // week 1, day 3
    const { added, targets } = copySlotTo(plan, source, [{ week: 1, day: 1 }, { week: 3, day: 3 }], 4, makeId);
    expect(targets).toEqual([{ week: 1, day: 1 }, { week: 3, day: 3 }]);
    expect(added).toHaveLength(2);
    expect(added.map((s) => [s.week, s.day, s.position])).toEqual([[1, 1, 2], [3, 3, 0]]);
    for (const s of added) {
      expect(s.workoutId).toBe(source.workoutId);
      expect(s.workoutName).toBe(source.workoutName);
      expect(s.id).not.toBe(source.id);
    }
    expect(new Set(added.map((s) => s.id)).size).toBe(2);
  });

  it('ignores the source day, repeats and days outside the program, and sorts by week then day', () => {
    const source = plan[0]!; // week 1, day 1
    const { targets } = copySlotTo(
      plan,
      source,
      [{ week: 2, day: 7 }, { week: 1, day: 1 }, { week: 2, day: 7 }, { week: 5, day: 1 }, { week: 0, day: 2 }, { week: 2, day: 8 }, { week: 1.5, day: 2 }, { week: 2, day: 2 }],
      4,
      makeId,
    );
    expect(targets).toEqual([{ week: 2, day: 2 }, { week: 2, day: 7 }]);
  });

  it('adds nothing when no target is left', () => {
    expect(copySlotTo(plan, plan[0]!, [{ week: 1, day: 1 }], 4, makeId)).toEqual({ added: [], targets: [] });
  });
});
