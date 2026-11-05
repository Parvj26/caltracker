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
/** "9 Nov". */
export const formatDayMonth = (d: IsoDate) => dayMonth.format(at(d));
/** "Monday 9 November 2026". */
export const formatLongDay = (d: IsoDate) => longDay.format(at(d));
/** "November 2026" for "2026-11". */
export const formatMonth = (month: string) => monthYear.format(at(`${month}-01`));

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH.test(v);

/** "2026-11" shifted by `n` months, e.g. shiftMonth('2026-12', 1) is '2027-01'. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}
