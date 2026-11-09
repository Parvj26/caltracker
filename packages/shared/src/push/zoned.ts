import type { IsoDate } from '../dates/dates';

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
      numberingSystem: 'latn',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The local wall clock of an instant, written as if it were UTC (ms). */
function wallMs(instantMs: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
}

/** The zone's offset from UTC at an instant, in ms (local = UTC + offset). */
function offsetMs(instantMs: number, timeZone: string): number {
  return wallMs(instantMs, timeZone) - Math.floor(instantMs / 1000) * 1000;
}

/** Minutes since midnight of a wall time 'HH:MM' (or 'HH:MM:SS'). */
export function wallTimeMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * The instant a local wall time ('HH:MM') on a local date happens in a time zone. A wall time that does not exist
 * (the spring-forward gap) maps to the first instant after the gap; an ambiguous one (fall-back) to the earlier one.
 */
export function localWallTimeToUtc(date: IsoDate, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, mo - 1, d) + wallTimeMinutes(time) * MINUTE;
  // At most one offset change happens within a day either side of the target.
  const before = offsetMs(target - DAY, timeZone);
  const after = offsetMs(target + DAY, timeZone);
  const candidates = [...new Set([target - before, target - after])]
    .filter((t) => wallMs(t, timeZone) === target)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]!);
  // In a gap: find the change between the two guesses (the earlier one still has the old offset).
  let lo = Math.min(target - before, target - after);
  let hi = Math.max(target - before, target - after);
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (offsetMs(mid, timeZone) === before) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** Minutes since local midnight (0–1439) of an instant in a time zone. */
export function localMinutes(instant: Date, timeZone: string): number {
  const ms = wallMs(instant.getTime(), timeZone);
  return Math.floor((((ms % DAY) + DAY) % DAY) / MINUTE);
}
