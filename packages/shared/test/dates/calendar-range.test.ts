import { describe, expect, it } from 'vitest';
import {
  CALENDAR_VIEWS,
  calendarRange,
  coveringRange,
  isCalendarView,
  shiftMonth,
  stepCalendar,
  switchAnchor,
} from '../../src/dates/calendar-range';
import { diffDays, isoWeekday } from '../../src/dates/dates';

describe('isCalendarView', () => {
  it('accepts only the four views', () => {
    for (const v of CALENDAR_VIEWS) expect(isCalendarView(v)).toBe(true);
    for (const v of ['3w', 'week', '', null, undefined, 2, ['2w']]) expect(isCalendarView(v)).toBe(false);
  });
});

describe('calendarRange: week views', () => {
  it('starts on the Monday of the anchor week, whatever day the anchor is', () => {
    // 2026-11-06 is a Friday; its week starts Monday 2 November.
    for (const anchor of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08']) {
      expect(calendarRange('2w', anchor).start).toBe('2026-11-02');
    }
  });
  it('runs 1, 2 or 4 whole weeks, Monday to Sunday', () => {
    const one = calendarRange('1w', '2026-11-06');
    expect(one).toMatchObject({ start: '2026-11-02', end: '2026-11-08', month: null });
    expect(one.weeks).toHaveLength(1);
    expect(calendarRange('2w', '2026-11-06').end).toBe('2026-11-15');
    const four = calendarRange('4w', '2026-11-06');
    expect(four.end).toBe('2026-11-29');
    expect(four.weeks).toHaveLength(4);
    for (const week of four.weeks) {
      expect(week).toHaveLength(7);
      expect(isoWeekday(week[0]!)).toBe(1);
      expect(isoWeekday(week[6]!)).toBe(7);
    }
    // Every day once, in order.
    const days = four.weeks.flat();
    days.slice(1).forEach((d, i) => expect(diffDays(days[i]!, d)).toBe(1));
  });
  it('crosses month and year boundaries', () => {
    expect(calendarRange('2w', '2026-10-28')).toMatchObject({ start: '2026-10-26', end: '2026-11-08' });
    expect(calendarRange('2w', '2026-12-31')).toMatchObject({ start: '2026-12-28', end: '2027-01-10' });
    expect(calendarRange('1w', '2028-02-29')).toMatchObject({ start: '2028-02-28', end: '2028-03-05' });
  });
  it('is not shifted by daylight-saving changes (Europe 29 Mar and 25 Oct 2026, US 1 Nov 2026)', () => {
    expect(calendarRange('1w', '2026-03-29')).toMatchObject({ start: '2026-03-23', end: '2026-03-29' });
    expect(calendarRange('1w', '2026-03-30')).toMatchObject({ start: '2026-03-30', end: '2026-04-05' });
    expect(calendarRange('2w', '2026-10-25')).toMatchObject({ start: '2026-10-19', end: '2026-11-01' });
    expect(calendarRange('4w', '2026-11-01').weeks.flat()).toHaveLength(28);
  });
});

describe('calendarRange: month view', () => {
  it('is the month padded to whole Monday-first weeks', () => {
    const r = calendarRange('month', '2026-11-17');
    expect(r).toMatchObject({ start: '2026-10-26', end: '2026-12-06', month: '2026-11' });
    expect(r.weeks).toHaveLength(6);
    // February 2027 starts on a Monday and ends on a Sunday: exactly 4 rows.
    expect(calendarRange('month', '2027-02-10')).toMatchObject({ start: '2027-02-01', end: '2027-02-28' });
  });
});

describe('stepCalendar', () => {
  it('steps by the view length and lands on a Monday', () => {
    expect(stepCalendar('1w', '2026-11-06', 1)).toBe('2026-11-09');
    expect(stepCalendar('1w', '2026-11-06', -1)).toBe('2026-10-26');
    expect(stepCalendar('2w', '2026-11-06', 1)).toBe('2026-11-16');
    expect(stepCalendar('2w', '2026-11-06', -1)).toBe('2026-10-19');
    expect(stepCalendar('4w', '2026-11-06', 1)).toBe('2026-11-30');
    expect(stepCalendar('4w', '2026-11-06', -2)).toBe('2026-09-07');
  });
  it('steps back and forth to the same place, across daylight-saving changes and years', () => {
    let a = '2026-03-23';
    for (let i = 0; i < 40; i++) a = stepCalendar('2w', a, 1);
    expect(a).toBe('2027-10-04');
    for (let i = 0; i < 40; i++) a = stepCalendar('2w', a, -1);
    expect(a).toBe('2026-03-23');
  });
  it('steps whole months in the month view, landing on the 1st', () => {
    expect(stepCalendar('month', '2026-11-30', 1)).toBe('2026-12-01');
    expect(stepCalendar('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(stepCalendar('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(stepCalendar('month', '2026-03-31', -1)).toBe('2026-02-01');
  });
});

describe('shiftMonth', () => {
  it('wraps years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', -23)).toBe('2024-12');
  });
});

describe('switchAnchor', () => {
  it('keeps today when it is on screen', () => {
    expect(switchAnchor(calendarRange('2w', '2026-11-06'), '2026-11-06')).toBe('2026-11-06');
    expect(switchAnchor(calendarRange('month', '2026-11-01'), '2026-11-06')).toBe('2026-11-06');
  });
  it('otherwise keeps the start of what is on screen', () => {
    expect(switchAnchor(calendarRange('2w', '2026-12-10'), '2026-11-06')).toBe('2026-12-07');
    // The month view's padding days don't count as on screen: it is the 1st of the month.
    expect(switchAnchor(calendarRange('month', '2026-12-01'), '2026-11-30')).toBe('2026-12-01');
  });
});

describe('coveringRange', () => {
  it('covers every view around every anchor', () => {
    expect(coveringRange(CALENDAR_VIEWS, ['2026-11-05', '2026-11-07'])).toEqual({ start: '2026-10-26', end: '2026-12-06' });
    // A 4-week view from the last Monday of November runs past the month view's padding.
    expect(coveringRange(CALENDAR_VIEWS, ['2026-11-30'])).toEqual({ start: '2026-10-26', end: '2026-12-27' });
    expect(coveringRange(['1w'], ['2026-11-06'])).toEqual({ start: '2026-11-02', end: '2026-11-08' });
  });
  it('refuses an empty list', () => {
    expect(() => coveringRange([], ['2026-11-06'])).toThrow();
  });
});
