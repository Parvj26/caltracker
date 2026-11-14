import { describe, expect, it } from 'vitest';
import { formatDayMonth, formatLongDay, formatMonth, formatRange, formatShortDay, formatWeekday } from './format';

describe('formatRange', () => {
  it('writes the year once, or both years when the range crosses one', () => {
    expect(formatRange('2026-10-26', '2026-11-08')).toBe('26 Oct – 8 Nov 2026');
    expect(formatRange('2026-12-28', '2027-01-10')).toBe('28 Dec 2026 – 10 Jan 2027');
  });
});

// Rendered on the server (Node) and again in Safari: these must be the same everywhere, so September is "Sep".
describe('calendar date labels', () => {
  it('uses "Sep", never "Sept"', () => {
    expect(formatShortDay('2026-09-07')).toBe('Mon 7 Sep');
    expect(formatDayMonth('2026-09-07')).toBe('7 Sep');
    expect(formatRange('2026-08-31', '2026-09-13')).toBe('31 Aug – 13 Sep 2026');
    expect(formatRange('2026-09-28', '2026-10-11')).toBe('28 Sep – 11 Oct 2026');
  });

  it('keeps the other labels', () => {
    expect(formatShortDay('2026-11-09')).toBe('Mon 9 Nov');
    expect(formatWeekday('2026-11-09')).toBe('Mon');
    expect(formatLongDay('2026-11-09')).toBe('Monday 9 November 2026');
    expect(formatMonth('2026-09')).toBe('September 2026');
  });
});
