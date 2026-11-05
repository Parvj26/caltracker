import { addDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { LANDMARK_JOURNEY } from './catalogue';

/** The Monday of the week an instant falls in, as seen in the given time zone. */
export function weekKey(isoTimestamp: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    numberingSystem: 'latn',
  }).formatToParts(new Date(isoTimestamp));
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  const day = `${String(part('year')).padStart(4, '0')}-${String(part('month')).padStart(2, '0')}-${String(part('day')).padStart(2, '0')}`;
  return startOfWeek(day);
}

/**
 * Consecutive weeks with a workout. The current week counts once it has a workout; without one yet it does not
 * break the streak (the week is not over).
 */
export function streakWeeks(
  completedWeekKeys: readonly IsoDate[],
  currentWeek: IsoDate,
): { current: number; best: number } {
  const weeks = new Set(completedWeekKeys.filter((w) => w <= currentWeek));
  let best = 0;
  for (const w of weeks) {
    if (weeks.has(addDays(w, -7))) continue; // not the start of a run
    let n = 0;
    for (let d = w; weeks.has(d); d = addDays(d, 7)) n += 1;
    best = Math.max(best, n);
  }
  let current = 0;
  for (let d = weeks.has(currentWeek) ? currentWeek : addDays(currentWeek, -7); weeks.has(d); d = addDays(d, -7)) {
    current += 1;
  }
  return { current, best };
}

/** Landmarks reached at exactly this streak, and the next one ahead. */
export function journeyStep(streak: number): {
  reached: string[];
  next: { week: number; key: string } | null;
} {
  return {
    reached: LANDMARK_JOURNEY.filter((s) => s.week === streak).map((s) => s.key),
    next: LANDMARK_JOURNEY.find((s) => s.week > streak) ?? null,
  };
}
