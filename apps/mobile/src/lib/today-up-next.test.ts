import { describe, expect, it } from 'vitest';
import { allWorkoutsDone, upNextDue, upNextLine } from './today-logic';

const done = { kind: 'done' };
const going = { kind: 'in_progress' };
const next = (scheduledOn: string) => ({ id: 'w-next', name: 'Parv - Lower', scheduledOn });

describe('Up next: when it shows', () => {
  it('shows once every one of today’s workouts is done', () => {
    expect(allWorkoutsDone(['a'], { a: done })).toBe(true);
    expect(allWorkoutsDone(['a', 'b'], { a: done, b: done })).toBe(true);
  });

  it('hides while one is still to do or going', () => {
    expect(allWorkoutsDone(['a', 'b'], { a: done })).toBe(false);
    expect(allWorkoutsDone(['a', 'b'], { a: done, b: going })).toBe(false);
    expect(allWorkoutsDone(['a'], {})).toBe(false);
  });

  it('never on a rest day (no workouts: the rest card says what is next)', () => {
    expect(allWorkoutsDone([], {})).toBe(false);
  });

  it('only for a workout planned in the next 7 days', () => {
    expect(upNextLine(next('2026-11-21'), '2026-11-20')).not.toBeNull();
    expect(upNextLine(next('2026-11-27'), '2026-11-20')).not.toBeNull();
    expect(upNextLine(next('2026-11-28'), '2026-11-20')).toBeNull();
    expect(upNextLine(null, '2026-11-20')).toBeNull();
  });

  it('never for today or a past date', () => {
    expect(upNextLine(next('2026-11-20'), '2026-11-20')).toBeNull();
    expect(upNextLine(next('2026-11-19'), '2026-11-20')).toBeNull();
  });
});

describe('Up next: what it says', () => {
  it('names the day as the rest day does, and the workout', () => {
    expect(upNextLine(next('2026-11-21'), '2026-11-20')).toEqual({
      id: 'w-next',
      name: 'Parv - Lower',
      label: 'Up next · Saturday',
      accessibilityLabel: 'Up next: Parv - Lower, Saturday. Preview',
    });
  });

  it('uses the date 7 days ahead (the same weekday as today)', () => {
    expect(upNextLine(next('2026-11-27'), '2026-11-20')?.label).toBe('Up next · Fri 27 Nov');
  });
});

describe('Up next: never mid-workout', () => {
  const base = { workoutIds: ['a'], statuses: { a: done }, offline: false, workoutInProgress: false };
  it('shows once all done, online, with nothing going', () => {
    expect(upNextDue(base)).toBe(true);
  });
  it('hides while an empty or unplanned workout started after the planned one is going', () => {
    expect(upNextDue({ ...base, workoutInProgress: true })).toBe(false);
  });
  it('hides offline and while not all done', () => {
    expect(upNextDue({ ...base, offline: true })).toBe(false);
    expect(upNextDue({ ...base, statuses: {} })).toBe(false);
  });
});
