import { describe, expect, it } from 'vitest';
import { formatRelativeDay, formatTimeOfDay, groupByLocalDay } from '../../src/dates/format';

describe('formatTimeOfDay', () => {
  it('prints 12-hour time with am/pm in the given zone', () => {
    expect(formatTimeOfDay('2026-11-12T09:40:00Z', 'UTC')).toBe('9:40 am');
    expect(formatTimeOfDay('2026-11-12T00:05:00Z', 'UTC')).toBe('12:05 am');
    expect(formatTimeOfDay('2026-11-12T12:00:00Z', 'UTC')).toBe('12:00 pm');
    // 11:30 pm in Los Angeles is 07:30 UTC the next day.
    expect(formatTimeOfDay('2026-11-05T07:30:00Z', 'America/Los_Angeles')).toBe('11:30 pm');
  });
});

describe('formatRelativeDay', () => {
  it('says Today and Yesterday, then the weekday and date', () => {
    expect(formatRelativeDay('2026-11-13', '2026-11-13')).toBe('Today');
    expect(formatRelativeDay('2026-11-12', '2026-11-13')).toBe('Yesterday');
    expect(formatRelativeDay('2026-11-09', '2026-11-13')).toBe('Mon 9 Nov');
  });

  it('adds the year for another year', () => {
    expect(formatRelativeDay('2025-12-30', '2026-01-02')).toBe('Tue 30 Dec 2025');
  });

  it('says Yesterday across a new year', () => {
    expect(formatRelativeDay('2025-12-31', '2026-01-01')).toBe('Yesterday');
  });
});

describe('groupByLocalDay', () => {
  const at = (iso: string) => ({ id: iso, finishedAt: iso });
  const now = '2026-11-13T15:00:00Z';

  it('groups newest-first items under one heading per local day, keeping their order', () => {
    const items = [at('2026-11-13T09:40:00Z'), at('2026-11-13T07:15:00Z'), at('2026-11-12T18:30:00Z'), at('2026-11-09T20:10:00Z'), at('2026-11-09T12:20:00Z')];
    const groups = groupByLocalDay(items, (i) => i.finishedAt, now, 'UTC');
    expect(groups.map((g) => [g.day, g.label, g.items.map((i) => i.id)])).toEqual([
      ['2026-11-13', 'Today', ['2026-11-13T09:40:00Z', '2026-11-13T07:15:00Z']],
      ['2026-11-12', 'Yesterday', ['2026-11-12T18:30:00Z']],
      ['2026-11-09', 'Mon 9 Nov', ['2026-11-09T20:10:00Z', '2026-11-09T12:20:00Z']],
    ]);
  });

  it('uses the viewer’s time zone for both the items and today', () => {
    // 07:30 UTC on 13 Nov is still 12 Nov, 11:30 pm in Los Angeles; "now" there is 13 Nov, 7 am.
    const groups = groupByLocalDay([at('2026-11-13T09:00:00Z'), at('2026-11-13T07:30:00Z')], (i) => i.finishedAt, now, 'America/Los_Angeles');
    expect(groups.map((g) => [g.day, g.label, g.items.length])).toEqual([
      ['2026-11-13', 'Today', 1],
      ['2026-11-12', 'Yesterday', 1],
    ]);
    // The same instants in UTC are both today.
    expect(groupByLocalDay([at('2026-11-13T09:00:00Z'), at('2026-11-13T07:30:00Z')], (i) => i.finishedAt, now, 'UTC')).toHaveLength(1);
  });

  it('joins items of one day even when they are not next to each other', () => {
    const groups = groupByLocalDay([at('2026-11-13T09:00:00Z'), at('2026-11-12T09:00:00Z'), at('2026-11-13T08:00:00Z')], (i) => i.finishedAt, now, 'UTC');
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
  });

  it('is empty for no items', () => {
    expect(groupByLocalDay([], () => now, now, 'UTC')).toEqual([]);
  });
});
