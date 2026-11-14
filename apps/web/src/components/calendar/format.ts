import {
  formatPlainDay,
  formatPlainDayMonth,
  formatPlainDayMonthYear,
  formatPlainLongDay,
  formatPlainMonth,
  formatPlainWeekday,
  shiftMonth,
} from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';

// Calendar dates are plain YYYY-MM-DD with no time zone. They're rendered on the server (Node) and again in the
// browser, so the words come from the shared formatter: Node's Intl says "Sept" where Safari says "Sep", and any
// difference is a hydration error.

/** "Mon 9 Nov". */
export const formatShortDay = (d: IsoDate) => formatPlainDay(d);
/** "Mon". */
export const formatWeekday = (d: IsoDate) => formatPlainWeekday(d);
/** "9 Nov". */
export const formatDayMonth = (d: IsoDate) => formatPlainDayMonth(d);
/** "Monday 9 November 2026". */
export const formatLongDay = (d: IsoDate) => formatPlainLongDay(d);
/** "November 2026" for "2026-11". */
export const formatMonth = (month: string) => formatPlainMonth(month);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH.test(v);

/** "2026-11" shifted by `n` months, e.g. shiftMonth('2026-12', 1) is '2027-01'. */
export { shiftMonth };

/**
 * A week view's range, the app's way ("9 Nov"): "26 Oct – 8 Nov 2026", or with both years when it crosses one,
 * "28 Dec 2026 – 10 Jan 2027".
 */
export function formatRange(start: IsoDate, end: IsoDate): string {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${formatDayMonth(start)} – ${formatPlainDayMonthYear(end)}`
    : `${formatPlainDayMonthYear(start)} – ${formatPlainDayMonthYear(end)}`;
}
