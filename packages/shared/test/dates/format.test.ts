import { describe, expect, it } from 'vitest';
import {
  MONTHS_SHORT,
  formatDateTime,
  formatDayDate,
  formatPlainDay,
  formatTimeOfDay,
  formatWeekRange,
  formatWeekdayDay,
  formatPlainDayMonth,
  formatPlainDayMonthYear,
  formatPlainLongDay,
  formatPlainMonth,
  formatPlainWeekday,
} from '../../src/dates/format';

// These strings are rendered on the server (Node ICU) and again in the browser (WebKit, Blink). They must match
// exactly, or React reports a hydration error, so they're built from numbers plus our own month names.
describe('formatDateTime', () => {
  it('prints day, short month and 12-hour time with a comma, never "at"', () => {
    expect(formatDateTime('2026-11-12T02:38:00Z', 'UTC')).toBe('12 Nov, 2:38 am');
    expect(formatDateTime('2026-11-12T14:05:00Z', 'UTC')).toBe('12 Nov, 2:05 pm');
  });

  it('uses "Sep", not "Sept"', () => {
    expect(formatDateTime('2026-09-03T09:00:00Z', 'UTC')).toBe('3 Sep, 9:00 am');
  });

  it('shows midnight and noon as 12', () => {
    expect(formatDateTime('2026-01-01T00:00:00Z', 'UTC')).toBe('1 Jan, 12:00 am');
    expect(formatDateTime('2026-01-01T12:30:00Z', 'UTC')).toBe('1 Jan, 12:30 pm');
  });

  it('converts to the given time zone', () => {
    // 11:30 pm in Los Angeles on 4 Nov is 07:30 UTC on 5 Nov.
    expect(formatDateTime('2026-11-05T07:30:00Z', 'America/Los_Angeles')).toBe('4 Nov, 11:30 pm');
    expect(formatDateTime('2026-11-05T07:30:00Z', 'Asia/Dubai')).toBe('5 Nov, 11:30 am');
  });
});

describe('formatDayDate', () => {
  it('prints day, short month and year', () => {
    expect(formatDayDate('2026-09-30T23:00:00Z', 'UTC')).toBe('30 Sep 2026');
    expect(formatDayDate('2026-09-30T23:00:00Z', 'Asia/Dubai')).toBe('1 Oct 2026');
  });
});

describe('formatPlainDay', () => {
  it('prints a calendar date as weekday, day and short month', () => {
    expect(formatPlainDay('2026-10-31')).toBe('Sat 31 Oct');
    expect(formatPlainDay('2026-09-07')).toBe('Mon 7 Sep');
  });
});

describe('formatWeekdayDay', () => {
  it('prints a calendar date as weekday and day of the month', () => {
    expect(formatWeekdayDay('2026-11-09')).toBe('Mon 9');
    expect(formatWeekdayDay('2026-11-15')).toBe('Sun 15');
  });
});

describe('formatWeekRange', () => {
  it('names the month once when the week stays in it', () => {
    expect(formatWeekRange('2026-11-09')).toBe('9–15 Nov');
  });
  it('names both months when the week crosses into the next', () => {
    expect(formatWeekRange('2026-11-30')).toBe('30 Nov – 6 Dec');
  });
  it('adds the years when the week crosses into the next year', () => {
    expect(formatWeekRange('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

describe('MONTHS_SHORT', () => {
  it('has twelve three-letter names', () => {
    expect(MONTHS_SHORT).toHaveLength(12);
    expect(MONTHS_SHORT.every((m) => m.length === 3)).toBe(true);
  });
});

describe('formatTimeOfDay', () => {
  it('prints 12-hour time with am or pm, in the given zone', () => {
    expect(formatTimeOfDay('2026-11-13T17:12:00Z', 'UTC')).toBe('5:12 pm');
    expect(formatTimeOfDay('2026-11-13T00:05:00Z', 'UTC')).toBe('12:05 am');
    expect(formatTimeOfDay('2026-11-13T07:30:00Z', 'America/Los_Angeles')).toBe('11:30 pm');
  });
});

describe('plain calendar date labels', () => {
  it('prints day and short month, with "Sep" not "Sept"', () => {
    expect(formatPlainDayMonth('2026-11-09')).toBe('9 Nov');
    expect(formatPlainDayMonth('2026-09-07')).toBe('7 Sep');
  });

  it('prints day, short month and year', () => {
    expect(formatPlainDayMonthYear('2026-09-30')).toBe('30 Sep 2026');
    expect(formatPlainDayMonthYear('2027-01-10')).toBe('10 Jan 2027');
  });

  it('prints the short weekday', () => {
    expect(formatPlainWeekday('2026-09-07')).toBe('Mon');
    expect(formatPlainWeekday('2026-11-15')).toBe('Sun');
  });

  it('prints the long day without commas', () => {
    expect(formatPlainLongDay('2026-11-09')).toBe('Monday 9 November 2026');
    expect(formatPlainLongDay('2026-09-05')).toBe('Saturday 5 September 2026');
  });

  it('prints a YYYY-MM month as its long name and year', () => {
    expect(formatPlainMonth('2026-09')).toBe('September 2026');
    expect(formatPlainMonth('2027-01')).toBe('January 2027');
  });
});
