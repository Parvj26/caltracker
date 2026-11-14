import type { IsoDate } from './dates';

/**
 * Date and time labels that come out the same on every JavaScript engine.
 *
 * Web pages are rendered on the server (Node) and then again in the browser. Engines ship different locale data:
 * Node prints en-GB September as "Sept" and joins date and time with ", ", while Safari prints "Sep" and " at ". Any
 * difference makes React throw a hydration error, so only numbers are taken from Intl and the words are our own.
 */

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Numeric wall-clock parts of an instant in a time zone (default: the viewer's own). */
function zonedParts(instant: string | Date, timeZone?: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    numberingSystem: 'latn',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** "12 Nov, 2:38 am" in the given time zone (default: the viewer's own). */
export function formatDateTime(instant: string | Date, timeZone?: string): string {
  const p = zonedParts(instant, timeZone);
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}, ${hour}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`;
}

/** "12 Nov 2026" for the day an instant falls on in the given time zone (default: the viewer's own). */
export function formatDayDate(instant: string | Date, timeZone?: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** A plain calendar date (no time zone) as "Sat 31 Oct". */
export function formatPlainDay(d: IsoDate): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${WEEKDAYS_SHORT[weekday]} ${day} ${MONTHS_SHORT[m - 1]}`;
}
