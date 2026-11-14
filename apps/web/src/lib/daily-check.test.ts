import { describe, expect, it } from 'vitest';
import { reasonText, shortDay } from './daily-check';

// Thursday 5 November 2026.
const TODAY = '2026-11-05';

describe('shortDay', () => {
  it('says today and yesterday, and a short weekday date otherwise', () => {
    expect(shortDay(TODAY, TODAY)).toBe('today');
    expect(shortDay('2026-11-04', TODAY)).toBe('yesterday');
    expect(shortDay('2026-11-03', TODAY)).toBe('Tue 3 Nov');
    expect(shortDay('2026-09-07', TODAY)).toBe('Mon 7 Sep');
  });
});

describe('reasonText', () => {
  it('states each reason in plain words', () => {
    expect(reasonText({ kind: 'missed_in_a_row', count: 3, lastMissedOn: '2026-11-04' }, TODAY)).toBe('Missed 3 in a row · latest yesterday');
    expect(reasonText({ kind: 'missed', count: 1, lastMissedOn: '2026-11-03' }, TODAY)).toBe('Missed 1 · Tue 3 Nov');
    expect(reasonText({ kind: 'missed', count: 2, lastMissedOn: '2026-11-03' }, TODAY)).toBe('Missed 2 · latest Tue 3 Nov');
    expect(reasonText({ kind: 'program_ending', assignmentId: 'a', endDate: TODAY, daysLeft: 0 }, TODAY)).toBe('Ends today');
    expect(reasonText({ kind: 'program_ending', assignmentId: 'a', endDate: '2026-11-06', daysLeft: 1 }, TODAY)).toBe('Ends in 1 day · Fri 6 Nov');
    expect(reasonText({ kind: 'nothing_planned' }, TODAY)).toBe('Nothing in the next 7 days');
    expect(reasonText({ kind: 'quiet', days: 6, atLeast: false }, TODAY)).toBe('No workout in 6 days');
    expect(reasonText({ kind: 'quiet', days: 30, atLeast: true }, TODAY)).toBe('No workout in 30+ days');
    expect(reasonText({ kind: 'new_bests', count: 1 }, TODAY)).toBe('1 lift improved');
    expect(reasonText({ kind: 'new_bests', count: 4 }, TODAY)).toBe('4 lifts improved');
  });
});
