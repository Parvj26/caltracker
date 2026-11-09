import { describe, expect, it } from 'vitest';
import { trackedCount } from '../../src/coach-home/client-overview';
import { currentProgramLabel, thisWeekSummary, weekSentence } from '../../src/progress/week';
import { planned } from './fixtures';

// Thursday 5 November 2026: the week is Mon 2 to Sun 8 November.
const today = '2026-11-05';

describe('trackedCount', () => {
  it('counts planned and done between two days, today only once done, and added workouts', () => {
    const ws = [planned('2026-11-02', true), planned('2026-11-03'), planned(today), planned('2026-11-07')];
    expect(trackedCount(ws, ['2026-11-04', '2026-10-30'], '2026-11-02', today, today)).toEqual({ tracked: 1, planned: 2, added: 1 });
  });
});

describe('thisWeekSummary', () => {
  it('counts every workout planned Monday to Sunday and the planned ones done, plus added ones', () => {
    const s = thisWeekSummary({
      workouts: [planned('2026-11-02', true), planned('2026-11-04', true), planned('2026-11-06'), planned('2026-11-08'), planned('2026-11-09')],
      addedDays: ['2026-11-03', '2026-11-01'],
      prs: 2,
      streak: 5,
      today,
    });
    expect(s).toMatchObject({ done: 2, planned: 4, extra: 1, prs: 2, streak: 5 });
    expect(s.workoutsValue).toBe('2/4');
  });

  it('shows the count alone when nothing is planned', () => {
    const s = thisWeekSummary({ workouts: [], addedDays: ['2026-11-03'], prs: 0, streak: 1, today });
    expect(s.workoutsValue).toBe('1');
  });
});

describe('weekSentence', () => {
  const base = { done: 0, planned: 0, extra: 0, prs: 0, streak: 0 };
  it('celebrates a week with every planned workout done', () => {
    expect(weekSentence({ ...base, done: 3, planned: 3 })).toBe('Every planned workout done. Brilliant week.');
  });
  it('mentions new personal bests', () => {
    expect(weekSentence({ ...base, done: 1, planned: 3, prs: 2 })).toBe('Strong week: 2 new personal bests so far.');
    expect(weekSentence({ ...base, done: 1, planned: 3, prs: 1 })).toBe('Strong week: 1 new personal best so far.');
  });
  it('says how many planned workouts are left, never what was missed', () => {
    expect(weekSentence({ ...base, done: 1, planned: 3 })).toBe('Nice work. 2 more planned this week.');
    expect(weekSentence({ ...base, done: 2, planned: 3 })).toBe('Nice work. 1 more planned this week.');
  });
  it('praises any workout when nothing was planned', () => {
    expect(weekSentence({ ...base, extra: 1 })).toBe('Nice work. Every workout counts.');
  });
  it('invites one workout to keep a running streak', () => {
    expect(weekSentence({ ...base, planned: 2, streak: 5 })).toBe('One workout this week keeps your 5-week streak going.');
  });
  it('is upbeat with nothing done yet and no streak', () => {
    expect(weekSentence(base)).toBe('A new week. One workout gets you going.');
  });
});

describe('currentProgramLabel', () => {
  const a = (startDate: string, weeks: number, over: Partial<{ endDate: string | null; cancelledOn: string | null }> = {}) => ({
    programName: 'Strength Block',
    weeks,
    startDate,
    endDate: null,
    cancelledOn: null,
    ...over,
  });
  it('names the running program and its week', () => {
    expect(currentProgramLabel([a('2026-10-26', 8)], today)).toBe('Strength Block · week 2 of 8');
    expect(currentProgramLabel([a(today, 4)], today)).toBe('Strength Block · week 1 of 4');
  });
  it('is null before it starts, after it ends, or once cancelled', () => {
    expect(currentProgramLabel([a('2026-11-06', 4)], today)).toBeNull();
    expect(currentProgramLabel([a('2026-09-01', 4)], today)).toBeNull();
    expect(currentProgramLabel([a('2026-10-26', 8, { cancelledOn: '2026-11-01' })], today)).toBeNull();
    expect(currentProgramLabel([], today)).toBeNull();
  });
  it('uses the stored end date when there is one', () => {
    expect(currentProgramLabel([a('2026-09-01', 4, { endDate: '2026-12-01' })], today)).toBe('Strength Block · week 4 of 4');
  });
  it('picks the latest start when two overlap', () => {
    expect(currentProgramLabel([a('2026-10-01', 12), { ...a('2026-11-02', 6), programName: 'Hypertrophy' }], today)).toBe('Hypertrophy · week 1 of 6');
  });
});
