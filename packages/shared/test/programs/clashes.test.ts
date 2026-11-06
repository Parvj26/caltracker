import { describe, expect, it } from 'vitest';
import { programClashes } from '../../src/programs/clashes';

// Strength Foundations-like: Mon / Wed / Fri for 2 weeks, plus a week-3 slot that falls outside a 2-week program.
const slots = [
  { week: 1, day: 1 },
  { week: 1, day: 3 },
  { week: 1, day: 5 },
  { week: 2, day: 1 },
  { week: 3, day: 1 },
];

describe('programClashes', () => {
  it('is empty when no program day lands on a day that already has a workout', () => {
    expect(programClashes({ weeks: 2, slots }, '2026-11-09', [{ date: '2026-11-10', name: 'Run' }])).toEqual([]);
  });

  it('lists each clashing date once, in date order, with the names already there', () => {
    const existing = [
      { date: '2026-11-13', name: 'Deadlift Day' },
      { date: '2026-11-09', name: 'Upper Body A' },
      { date: '2026-11-09', name: 'Easy Cardio 30' },
      { date: '2026-11-12', name: 'Mobility' },
    ];
    expect(programClashes({ weeks: 2, slots }, '2026-11-09', existing)).toEqual([
      { date: '2026-11-09', names: ['Upper Body A', 'Easy Cardio 30'] },
      { date: '2026-11-13', names: ['Deadlift Day'] },
    ]);
  });

  it('counts a day once even when the program puts two workouts on it', () => {
    const twice = [{ week: 1, day: 1 }, { week: 1, day: 1 }];
    expect(programClashes({ weeks: 1, slots: twice }, '2026-11-09', [{ date: '2026-11-09', name: 'Run' }])).toEqual([
      { date: '2026-11-09', names: ['Run'] },
    ]);
  });

  it('ignores slots beyond the program length (they are not copied)', () => {
    expect(programClashes({ weeks: 2, slots }, '2026-11-09', [{ date: '2026-11-23', name: 'Run' }])).toEqual([]);
  });

  it('moves with the start date', () => {
    const existing = [{ date: '2026-11-09', name: 'Upper Body A' }];
    expect(programClashes({ weeks: 2, slots }, '2026-11-10', existing)).toEqual([]);
    expect(programClashes({ weeks: 2, slots }, '2026-11-07', existing)).toEqual([{ date: '2026-11-09', names: ['Upper Body A'] }]);
  });
});
