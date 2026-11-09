import { describe, expect, it } from 'vitest';
import { consistencyTile, consistencyWeeks, monthCalendar, plannedDonePercent } from '../../src/progress/consistency';
import { planned } from './fixtures';

// Thursday 5 November 2026: this week is Mon 2 to Sun 8 November.
const today = '2026-11-05';

describe('consistencyWeeks', () => {
  it('gives 8 weeks, oldest first, ending with this week', () => {
    const weeks = consistencyWeeks([], [], today);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]!.monday).toBe('2026-09-14');
    expect(weeks[7]!.monday).toBe('2026-11-02');
    expect(weeks[7]!.short).toBe('now');
    expect(weeks[0]!.short).toBe('w1');
  });

  it('marks a week with every planned workout done as all, some done as some, nothing as none, no plan as rest', () => {
    const ws = [
      planned('2026-10-26', true),
      planned('2026-10-28', true), // week of 26 Oct: all
      planned('2026-10-19', true),
      planned('2026-10-21'), // week of 19 Oct: some
      planned('2026-10-12'), // week of 12 Oct: none
    ];
    const weeks = consistencyWeeks(ws, [], today);
    const by = (m: string) => weeks.find((w) => w.monday === m)!;
    expect(by('2026-10-26')).toMatchObject({ planned: 2, done: 2, state: 'all', count: '2/2' });
    expect(by('2026-10-19')).toMatchObject({ planned: 2, done: 1, state: 'some', count: '1/2' });
    expect(by('2026-10-12')).toMatchObject({ planned: 1, done: 0, state: 'none' });
    expect(by('2026-10-05')).toMatchObject({ planned: 0, state: 'rest', count: '0' });
  });

  it('counts workouts the client added; a week with only those and no plan counts as all', () => {
    const weeks = consistencyWeeks([], ['2026-10-27'], today);
    expect(weeks.find((w) => w.monday === '2026-10-26')).toMatchObject({ extra: 1, state: 'all', count: '1' });
  });

  it('counts the whole of this week as planned, and labels each week for a screen reader without saying missed', () => {
    const weeks = consistencyWeeks([planned('2026-11-02', true), planned('2026-11-07')], [], today);
    expect(weeks[7]).toMatchObject({ planned: 2, done: 1, state: 'some' });
    expect(weeks[7]!.label).toBe('This week: 1 of 2 planned workouts done');
    expect(weeks.map((w) => w.label).join(' ')).not.toMatch(/miss/i);
  });
});

describe('plannedDonePercent', () => {
  it('is the share of planned workouts done over the 8 weeks, up to today (today only once done)', () => {
    const ws = [planned('2026-10-26', true), planned('2026-10-28'), planned('2026-11-02', true), planned(today), planned('2026-11-07')];
    expect(plannedDonePercent(ws, [], today)).toBe(67);
  });
  it('is null when nothing was planned', () => {
    expect(plannedDonePercent([], ['2026-11-02'], today)).toBeNull();
  });
});

describe('consistencyTile', () => {
  it('shows the percent of planned done', () => {
    expect(consistencyTile(88, 0)).toEqual({ value: '88%', sub: 'planned done · 8 weeks' });
  });
  it('shows workouts done when nothing was planned', () => {
    expect(consistencyTile(null, 3)).toEqual({ value: '3 workouts', sub: 'last 8 weeks' });
    expect(consistencyTile(null, 1)).toEqual({ value: '1 workout', sub: 'last 8 weeks' });
  });
});

describe('monthCalendar', () => {
  it('lays out this month Monday first, with trained days filled and today marked', () => {
    const cal = monthCalendar(['2026-11-02', '2026-11-04', '2026-10-31'], today);
    expect(cal.title).toBe('November 2026');
    expect(cal.weekdays).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    const cells = cal.rows.flat();
    // 1 November 2026 is a Sunday: the first row starts on Monday 26 October.
    expect(cells[0]).toMatchObject({ date: '2026-10-26', inMonth: false });
    const nov = (d: number) => cells.find((c) => c.date === `2026-11-${String(d).padStart(2, '0')}`)!;
    expect(nov(2)).toMatchObject({ trained: true, isToday: false, future: false, day: 2, label: '2 November, workout done' });
    expect(nov(5)).toMatchObject({ trained: false, isToday: true, label: '5 November, today' });
    expect(nov(6)).toMatchObject({ future: true, label: '6 November' });
    expect(nov(3).label).toBe('3 November');
  });
});
