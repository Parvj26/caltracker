import { describe, expect, it } from 'vitest';
import { lastWorkoutText, planLines, relativeDay, statusText } from './directory-copy';

// Thursday 5 November 2026.
const TODAY = '2026-11-05';

describe('relativeDay', () => {
  it('says today, tomorrow, a weekday this week, else the date', () => {
    expect(relativeDay(TODAY, TODAY)).toBe('today');
    expect(relativeDay('2026-11-06', TODAY)).toBe('tomorrow');
    expect(relativeDay('2026-11-06', TODAY, true)).toBe('tomorrow');
    expect(relativeDay('2026-11-07', TODAY)).toBe('Sat');
    expect(relativeDay('2026-11-07', TODAY, true)).toBe('Saturday');
    expect(relativeDay('2026-11-29', TODAY)).toBe('29 Nov');
  });
});

describe('statusText', () => {
  it('words each status', () => {
    expect(statusText({ kind: 'training' }, TODAY)).toBe('Training now');
    expect(statusText({ kind: 'missed', count: 2 }, TODAY)).toBe('Missed 2 this week');
    expect(statusText({ kind: 'plan_ending', endDate: '2026-11-06' }, TODAY)).toBe('Plan ends tomorrow');
    expect(statusText({ kind: 'plan_ending', endDate: '2026-11-08' }, TODAY)).toBe('Plan ends Sunday');
    expect(statusText({ kind: 'nothing_planned' }, TODAY)).toBe('Nothing planned');
    expect(statusText({ kind: 'active' }, TODAY)).toBe('Active');
  });
});

describe('lastWorkoutText', () => {
  it('adds the workout name to the day', () => {
    expect(lastWorkoutText({ lastWorkout: { on: TODAY, name: 'Upper/Core' }, joinedOn: '2026-09-01' }, TODAY, 90)).toBe('Today · Upper/Core');
    expect(lastWorkoutText({ lastWorkout: null, joinedOn: '2026-11-01' }, TODAY, 90)).toBe('None yet');
  });
});

describe('planLines', () => {
  it('shows the program and its end, warning when nothing follows', () => {
    expect(planLines({ kind: 'program', name: 'PPL 8wk', endDate: '2026-11-29', endingSoon: false }, TODAY)).toEqual({
      title: 'PPL 8wk',
      detail: 'ends 29 Nov',
      warn: false,
    });
    expect(planLines({ kind: 'program', name: 'PPL 8wk', endDate: '2026-11-06', endingSoon: true }, TODAY)).toEqual({
      title: 'PPL 8wk',
      detail: 'ends tomorrow · nothing after',
      warn: true,
    });
  });

  it('shows the next single workout, or nothing', () => {
    expect(planLines({ kind: 'single', name: 'Full Body A', on: '2026-11-09' }, TODAY)).toEqual({
      title: 'Single workout: Full Body A',
      detail: 'Mon 9 Nov',
      warn: false,
    });
    expect(planLines(null, TODAY)).toBeNull();
  });
});
