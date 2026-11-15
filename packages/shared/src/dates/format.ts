import { addDays, diffDays, localDateOf, zonedParts, type IsoDate, type ZonedParts } from './dates';

/**
 * Date and time labels that come out the same on every JavaScript engine.
 *
 * Web pages are rendered on the server (Node) and then again in the browser. Engines ship different locale data:
 * Node prints en-GB September as "Sept" and joins date and time with ", ", while Safari prints "Sep" and " at ". Any
 * difference makes React throw a hydration error, so only numbers are taken from Intl and the words are our own.
 */

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const clock = (p: ZonedParts) => `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`;

/** "12 Nov, 2:38 am" in the given time zone (default: the viewer's own). */
export function formatDateTime(instant: string | Date, timeZone?: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}, ${clock(p)}`;
}

/** "5:12 pm" in the given time zone (default: the viewer's own). */
export function formatTimeOfDay(instant: string | Date, timeZone?: string): string {
  return clock(zonedParts(instant, timeZone));
}

/** "Mon 9 Nov", with the year when it isn't `today`'s year ("Wed 31 Dec 2025"). */
export function formatPlainDayInYear(day: IsoDate, today: IsoDate): string {
  return withOtherYear(formatPlainDay(day), day, today);
}

/** "9 Nov", with the year when it isn't `today`'s year ("31 Dec 2025"). */
export function formatPlainDayMonthInYear(day: IsoDate, today: IsoDate): string {
  return withOtherYear(formatPlainDayMonth(day), day, today);
}

function withOtherYear(label: string, day: IsoDate, today: IsoDate): string {
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${day.slice(0, 4)}`;
}

/** A day heading relative to `today`: "Today", "Yesterday", else "Mon 9 Nov" (with the year when it isn't this year). */
export function formatRelativeDay(day: IsoDate, today: IsoDate): string {
  const ago = diffDays(day, today);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return formatPlainDayInYear(day, today);
}

/** The day an instant falls on, relative to the day `now` falls on, both in `timeZone`: "Today", "Yesterday", "Mon 2 Nov". */
export function formatRelativeInstantDay(instant: string | Date, now: string | Date, timeZone?: string): string {
  return formatRelativeDay(localDateOf(instant, timeZone), localDateOf(now, timeZone));
}

/** "today", "yesterday" or "tomorrow" for a day next to `today`, else null. */
export function nearDayWord(day: IsoDate, today: IsoDate): 'today' | 'yesterday' | 'tomorrow' | null {
  const d = diffDays(today, day);
  return d === 0 ? 'today' : d === -1 ? 'yesterday' : d === 1 ? 'tomorrow' : null;
}

/** "yesterday", "today", "tomorrow", else "Sun 15 Nov". */
export function formatNearDay(day: IsoDate, today: IsoDate): string {
  return nearDayWord(day, today) ?? formatPlainDay(day);
}

/** "today", "yesterday", "tomorrow", "Thursday", or "last/next Thursday" a week or more away. */
export function formatWeekdayWord(day: IsoDate, today: IsoDate): string {
  const near = nearDayWord(day, today);
  if (near) return near;
  const d = diffDays(today, day);
  const name = formatPlainLongWeekday(day);
  if (d <= -7) return `last ${name}`;
  if (d >= 7) return `next ${name}`;
  return name;
}

/** Items gathered under one heading per local day, as `groupByLocalDay` returns them. */
export interface DayGroup<T> {
  day: IsoDate;
  /** "Today", "Yesterday" or "Mon 9 Nov". */
  label: string;
  items: T[];
}

/**
 * Newest-first items under one heading per calendar day in the given time zone (default: the viewer's own), e.g. the
 * Activity feed's "Today / Yesterday / Mon 9 Nov". Groups follow the order each day first appears; items keep their
 * order within a day. `now` decides which day is today, in the same zone.
 */
export function groupByLocalDay<T>(items: readonly T[], instantOf: (item: T) => string | Date, now: string | Date, timeZone?: string): DayGroup<T>[] {
  const today = localDateOf(now, timeZone);
  const groups = new Map<IsoDate, DayGroup<T>>();
  for (const item of items) {
    const day = localDateOf(instantOf(item), timeZone);
    let group = groups.get(day);
    if (!group) {
      group = { day, label: formatRelativeDay(day, today), items: [] };
      groups.set(day, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

/** "12 Nov 2026" for the day an instant falls on in the given time zone (default: the viewer's own). */
export function formatDayDate(instant: string | Date, timeZone?: string): string {
  return formatPlainDayMonthYear(localDateOf(instant, timeZone));
}

/** Numeric parts of a plain YYYY-MM-DD date, plus its weekday (0 = Sunday). No time zone is involved. */
function plainParts(d: IsoDate) {
  const [year, month, day] = d.split('-').map(Number) as [number, number, number];
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** A plain calendar date (no time zone) as "Sat 31 Oct". */
export function formatPlainDay(d: IsoDate): string {
  const p = plainParts(d);
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** A plain calendar date as "31 Oct". */
export function formatPlainDayMonth(d: IsoDate): string {
  const p = plainParts(d);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** A plain calendar date as "31 Oct 2026". */
export function formatPlainDayMonthYear(d: IsoDate): string {
  const p = plainParts(d);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** A plain calendar date's short weekday, "Sat". */
export function formatPlainWeekday(d: IsoDate): string {
  return WEEKDAYS_SHORT[plainParts(d).weekday] ?? '';
}

/** A plain calendar date's long weekday, "Saturday". */
export function formatPlainLongWeekday(d: IsoDate): string {
  return WEEKDAYS_LONG[plainParts(d).weekday] ?? '';
}

/** A plain calendar date as "Saturday 31 October 2026". */
export function formatPlainLongDay(d: IsoDate): string {
  const p = plainParts(d);
  return `${WEEKDAYS_LONG[p.weekday]} ${p.day} ${MONTHS_LONG[p.month - 1]} ${p.year}`;
}

/** A YYYY-MM month as "October 2026". */
export function formatPlainMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${year}`;
}

/** A plain calendar date as "Mon 9" (the month is shown elsewhere, as in a week's list of days). */
export function formatWeekdayDay(d: IsoDate): string {
  return formatPlainDay(d).split(' ').slice(0, 2).join(' ');
}

/** The seven days from `monday`: "9–15 Nov", "30 Nov – 6 Dec", or "28 Dec 2026 – 3 Jan 2027" across a new year. */
export function formatWeekRange(monday: IsoDate): string {
  const sunday = addDays(monday, 6);
  if (monday.slice(0, 4) !== sunday.slice(0, 4)) return `${formatPlainDayMonthYear(monday)} – ${formatPlainDayMonthYear(sunday)}`;
  if (monday.slice(5, 7) !== sunday.slice(5, 7)) return `${formatPlainDayMonth(monday)} – ${formatPlainDayMonth(sunday)}`;
  return `${plainParts(monday).day}–${formatPlainDayMonth(sunday)}`;
}
