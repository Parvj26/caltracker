import { z } from 'zod';

/** A calendar date as `YYYY-MM-DD`. Never goes through local time. */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

function toUtcMs(d: IsoDate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((s) => fromUtcMs(toUtcMs(s)) === s, 'That date does not exist.');

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(d) + n * MS_PER_DAY);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}

/** Monday = 1 ... Sunday = 7. */
export function isoWeekday(d: IsoDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const day = new Date(toUtcMs(d)).getUTCDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** The Monday on or before `d`. */
export function startOfWeek(d: IsoDate): IsoDate {
  return addDays(d, 1 - isoWeekday(d));
}

/** Monday-first weeks covering the month (`YYYY-MM`). */
export function monthGrid(month: string): IsoDate[][] {
  const first = `${month}-01`;
  const next = new Date(toUtcMs(first));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(fromUtcMs(next.getTime()), -1);
  const start = startOfWeek(first);
  const rows = Math.ceil((diffDays(start, last) + 1) / 7);
  return Array.from({ length: rows }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

/** Today's date in the given time zone (default: the viewer's own). */
export function localToday(timeZone?: string): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

export function programDayToDate(start: IsoDate, week: number, day: number): IsoDate {
  return addDays(start, (week - 1) * 7 + (day - 1));
}

export function programEndDate(start: IsoDate, weeks: number): IsoDate {
  return addDays(start, weeks * 7 - 1);
}
