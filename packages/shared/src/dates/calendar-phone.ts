import type { CalendarRange } from './calendar-range';
import type { IsoDate } from './dates';

/** How far a finger must travel sideways (px) before a swipe changes the calendar's weeks or month. */
export const SWIPE_MIN_PX = 60;

/**
 * What a finger's move across the calendar does: 1 for the next week(s) or month (a swipe to the left), -1 for the
 * previous (to the right), 0 for nothing (a tap, a short wobble, or a mostly up-and-down scroll). `dx` and `dy` are
 * where the finger let go minus where it touched down.
 */
export function calendarSwipeStep({ dx, dy }: { dx: number; dy: number }): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * The day whose workouts a phone shows under the calendar's dots: the day the coach picked while it is still on
 * screen, else today when it is in the month (or weeks) on screen, else the month's 1st (or the first day shown).
 */
export function phoneCalendarDay(range: Pick<CalendarRange, 'start' | 'end' | 'month'>, today: IsoDate, picked: IsoDate | null): IsoDate {
  if (picked !== null && picked >= range.start && picked <= range.end) return picked;
  if (range.month) return today.startsWith(`${range.month}-`) ? today : `${range.month}-01`;
  return today >= range.start && today <= range.end ? today : range.start;
}
