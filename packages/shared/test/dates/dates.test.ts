import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IsoDateSchema,
  addDays,
  diffDays,
  isoWeekday,
  localToday,
  monthGrid,
  programDayToDate,
  programEndDate,
  startOfWeek,
} from '../../src/dates/dates';

afterEach(() => vi.useRealTimers());

describe('date maths', () => {
  it('crosses year and leap-day boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('diffs days', () => {
    expect(diffDays('2026-03-01', '2026-03-29')).toBe(28);
    expect(diffDays('2026-03-29', '2026-03-01')).toBe(-28);
  });
  it('finds weekdays and week starts', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09');
    expect(startOfWeek('2026-11-09')).toBe('2026-11-09');
  });
  it('builds a Monday-first month grid', () => {
    const grid = monthGrid('2026-11');
    expect(grid).toHaveLength(6);
    expect(grid[0]![0]).toBe('2026-10-26');
    expect(grid[5]![6]).toBe('2026-12-06');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid('2027-02')).toHaveLength(4);
  });
});

describe('program dates', () => {
  it('survives DST changes', () => {
    expect(programDayToDate('2026-03-28', 1, 2)).toBe('2026-03-29');
    expect(programDayToDate('2026-03-07', 2, 2)).toBe('2026-03-15');
  });
  it('computes the end date', () => {
    expect(programEndDate('2026-11-09', 4)).toBe('2026-12-06');
  });
});

describe('localToday', () => {
  it('uses the viewer time zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T08:30:00Z'));
    expect(localToday('Pacific/Auckland')).toBe('2026-11-04');
    expect(localToday('America/Los_Angeles')).toBe('2026-11-04');
    vi.setSystemTime(new Date('2026-11-04T11:30:00Z'));
    expect(localToday('Pacific/Auckland')).toBe('2026-11-05');
    expect(localToday('America/Los_Angeles')).toBe('2026-11-04');
  });
});

describe('IsoDateSchema', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(IsoDateSchema.safeParse('2026-02-28').success).toBe(true);
    expect(IsoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(IsoDateSchema.safeParse('2026-2-3').success).toBe(false);
  });

  it('reports a badly formatted date as a format error instead of throwing', () => {
    for (const bad of ['31/12/2026', '', 'tomorrow']) {
      const r = IsoDateSchema.safeParse(bad);
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.message)).toEqual(['Use the format YYYY-MM-DD.']);
    }
  });
});
