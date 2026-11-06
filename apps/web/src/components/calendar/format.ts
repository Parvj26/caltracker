import { shiftMonth } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';

// Calendar dates are plain YYYY-MM-DD, so they are formatted as UTC midnight: no time zone can shift the day.
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const longDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const monthYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const at = (d: IsoDate) => new Date(`${d}T00:00:00Z`);

/** "Mon 9 Nov". */
export const formatShortDay = (d: IsoDate) => shortDay.format(at(d));
const weekdayName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
/** "Mon". */
export const formatWeekday = (d: IsoDate) => weekdayName.format(at(d));
/** "9 Nov". */
export const formatDayMonth = (d: IsoDate) => dayMonth.format(at(d));
/** "Monday 9 November 2026". */
export const formatLongDay = (d: IsoDate) => longDay.format(at(d));
/** "November 2026" for "2026-11". */
export const formatMonth = (month: string) => monthYear.format(at(`${month}-01`));

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH.test(v);

/** "2026-11" shifted by `n` months, e.g. shiftMonth('2026-12', 1) is '2027-01'. */
export { shiftMonth };

const dayMonthYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A week view's range, the app's way ("9 Nov"): "26 Oct – 8 Nov 2026", or with both years when it crosses one,
 * "28 Dec 2026 – 10 Jan 2027".
 */
export function formatRange(start: IsoDate, end: IsoDate): string {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${formatDayMonth(start)} – ${dayMonthYear.format(at(end))}`
    : `${dayMonthYear.format(at(start))} – ${dayMonthYear.format(at(end))}`;
}
