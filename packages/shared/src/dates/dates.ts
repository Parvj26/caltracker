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
  // abort: zod 4 runs later checks after a failed one, and the date check below throws on a malformed string.
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use the format YYYY-MM-DD.', abort: true })
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

/**
 * Today's date in the given time zone (default: the viewer's own).
 * Built from formatToParts rather than relying on a locale printing YYYY-MM-DD, which not every
 * JavaScript engine does (Hermes, React Native's engine, ships limited locale data).
 */
export function localToday(timeZone?: string): IsoDate {
  return localDateOf(new Date(), timeZone);
}

/**
 * The calendar day an instant (an ISO timestamp or a Date) falls on in the given time zone (default: the viewer's
 * own), e.g. which day of the coach's calendar a log finished at 11:30 pm belongs to.
 */
export function localDateOf(instant: string | Date, timeZone?: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    numberingSystem: 'latn',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  const [y, m, d] = [part('year'), part('month'), part('day')];
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function programDayToDate(start: IsoDate, week: number, day: number): IsoDate {
  return addDays(start, (week - 1) * 7 + (day - 1));
}

export function programEndDate(start: IsoDate, weeks: number): IsoDate {
  return addDays(start, weeks * 7 - 1);
}
