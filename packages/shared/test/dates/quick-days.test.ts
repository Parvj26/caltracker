import { describe, expect, it } from 'vitest';
import { busyLabel, plannedLabel, quickDays } from '../../src/dates/quick-days';

// 2026-11-13 is a Friday.
const FRI = '2026-11-13';

describe('quickDays', () => {
  it('gives Today, Tomorrow, the next weekday and Next Mon', () => {
    expect(quickDays(FRI)).toEqual([
      { date: '2026-11-13', label: 'Today', detail: 'Fri 13' },
      { date: '2026-11-14', label: 'Tomorrow', detail: 'Sat 14' },
      { date: '2026-11-15', label: 'Sun 15', detail: 'Sunday' },
      { date: '2026-11-16', label: 'Next Mon', detail: '16 Nov' },
    ]);
  });

  it('keeps Next Mon in the list when it falls past the count', () => {
    // Monday: next Monday is a week on, so it replaces the last weekday.
    expect(quickDays('2026-11-09').map((d) => [d.date, d.label])).toEqual([
      ['2026-11-09', 'Today'],
      ['2026-11-10', 'Tomorrow'],
      ['2026-11-11', 'Wed 11'],
      ['2026-11-16', 'Next Mon'],
    ]);
  });

  it('calls Monday "Tomorrow" on a Sunday, and has no separate Next Mon', () => {
    expect(quickDays('2026-11-15').map((d) => d.label)).toEqual(['Today', 'Tomorrow', 'Tue 17', 'Wed 18']);
  });

  it('skips excluded days and carries on past Next Mon', () => {
    // Move to…: the workout's own day (today) is left out.
    expect(quickDays(FRI, { exclude: [FRI] }).map((d) => [d.date, d.label])).toEqual([
      ['2026-11-14', 'Tomorrow'],
      ['2026-11-15', 'Sun 15'],
      ['2026-11-16', 'Next Mon'],
      ['2026-11-17', 'Tue 17'],
    ]);
  });

  it('starts no earlier than min', () => {
    expect(quickDays(FRI, { min: '2026-11-15', count: 2 }).map((d) => d.date)).toEqual(['2026-11-15', '2026-11-16']);
  });

  it('takes a count', () => {
    expect(quickDays(FRI, { count: 6 }).map((d) => d.label)).toEqual(['Today', 'Tomorrow', 'Sun 15', 'Next Mon', 'Tue 17', 'Wed 18']);
  });

  it('flags busy days when it knows them', () => {
    const counts: Record<string, number> = { '2026-11-16': 1, '2026-11-15': 2 };
    expect(quickDays(FRI, { exclude: [FRI], workoutsOn: (d) => counts[d] ?? 0 }).map((d) => [d.label, d.detail, d.busy])).toEqual([
      ['Tomorrow', 'Sat 14 · free', 0],
      ['Sun 15', '2 workouts', 2],
      ['Next Mon', '16 Nov · 1 workout', 1],
      ['Tue 17', 'free', 0],
    ]);
  });

  it('crosses a month and a year', () => {
    expect(quickDays('2026-12-31').map((d) => [d.label, d.detail])).toEqual([
      ['Today', 'Thu 31'],
      ['Tomorrow', 'Fri 1'],
      ['Sat 2', 'Saturday'],
      ['Next Mon', '4 Jan'],
    ]);
  });
});

describe('busyLabel', () => {
  it('says free, 1 workout or n workouts', () => {
    expect([0, 1, 3].map(busyLabel)).toEqual(['free', '1 workout', '3 workouts']);
  });
});

describe('plannedLabel', () => {
  it('names the next planned day from today on', () => {
    expect(plannedLabel(FRI, [])).toBe('Nothing planned');
    expect(plannedLabel(FRI, ['2026-11-10'])).toBe('Nothing planned');
    expect(plannedLabel(FRI, ['2026-11-20', FRI])).toBe('Planned today');
    expect(plannedLabel(FRI, ['2026-11-14'])).toBe('Planned tomorrow');
    expect(plannedLabel(FRI, ['2026-11-19', '2026-11-16'])).toBe('Planned Mon');
    expect(plannedLabel(FRI, ['2026-11-20'])).toBe('Planned 20 Nov');
  });
});
