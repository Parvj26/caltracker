import { describe, expect, it } from 'vitest';
import { SWIPE_MIN_PX, calendarSwipeStep, phoneCalendarDay } from '../../src/dates/calendar-phone';
import { calendarRange } from '../../src/dates/calendar-range';

describe('calendarSwipeStep', () => {
  it('a swipe to the left goes on (next), to the right goes back (previous)', () => {
    expect(calendarSwipeStep({ dx: -120, dy: 10 })).toBe(1);
    expect(calendarSwipeStep({ dx: 120, dy: -10 })).toBe(-1);
  });

  it('ignores short moves (a tap, a wobble)', () => {
    expect(calendarSwipeStep({ dx: 0, dy: 0 })).toBe(0);
    expect(calendarSwipeStep({ dx: SWIPE_MIN_PX - 1, dy: 0 })).toBe(0);
    expect(calendarSwipeStep({ dx: -(SWIPE_MIN_PX - 1), dy: 0 })).toBe(0);
    expect(calendarSwipeStep({ dx: SWIPE_MIN_PX, dy: 0 })).toBe(-1);
  });

  it('ignores mostly vertical moves (scrolling the page)', () => {
    expect(calendarSwipeStep({ dx: -80, dy: 200 })).toBe(0);
    expect(calendarSwipeStep({ dx: 80, dy: -80 })).toBe(0);
    // Clearly sideways: at least twice as far across as up or down.
    expect(calendarSwipeStep({ dx: -100, dy: 49 })).toBe(1);
    expect(calendarSwipeStep({ dx: -100, dy: 51 })).toBe(0);
  });
});

describe('phoneCalendarDay', () => {
  const november = calendarRange('month', '2026-11-12');

  it("starts on today when today is in the month on screen", () => {
    expect(phoneCalendarDay(november, '2026-11-12', null)).toBe('2026-11-12');
  });

  it('starts on the 1st when today is in another month', () => {
    expect(phoneCalendarDay(calendarRange('month', '2026-12-01'), '2026-11-12', null)).toBe('2026-12-01');
    expect(phoneCalendarDay(calendarRange('month', '2026-10-05'), '2026-11-12', null)).toBe('2026-10-01');
  });

  it('keeps a picked day while it is on screen, padding days of the next month included', () => {
    expect(phoneCalendarDay(november, '2026-11-12', '2026-11-20')).toBe('2026-11-20');
    // November 2026 ends on a Monday; the grid runs to Sunday 6 December.
    expect(november.end).toBe('2026-12-06');
    expect(phoneCalendarDay(november, '2026-11-12', '2026-12-03')).toBe('2026-12-03');
  });

  it('drops a picked day once it is no longer on screen', () => {
    expect(phoneCalendarDay(calendarRange('month', '2027-01-01'), '2026-11-12', '2026-11-20')).toBe('2027-01-01');
  });

  it('in a week view, starts on today when shown, else the first day', () => {
    expect(phoneCalendarDay(calendarRange('2w', '2026-11-12'), '2026-11-12', null)).toBe('2026-11-12');
    expect(phoneCalendarDay(calendarRange('1w', '2026-11-30'), '2026-11-12', null)).toBe('2026-11-30');
  });
});
