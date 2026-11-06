import { addDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { LANDMARK_JOURNEY } from './catalogue';

/** The calendar day an instant falls on, as seen in the given time zone. */
export function localDay(isoTimestamp: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    numberingSystem: 'latn',
  }).formatToParts(new Date(isoTimestamp));
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  return `${String(part('year')).padStart(4, '0')}-${String(part('month')).padStart(2, '0')}-${String(part('day')).padStart(2, '0')}`;
}

/** The Monday of the week an instant falls in, as seen in the given time zone. */
export function weekKey(isoTimestamp: string, timeZone: string): IsoDate {
  return startOfWeek(localDay(isoTimestamp, timeZone));
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

/**
 * The Monday of the last week that counts for the current streak: the current week if it has a workout, else last
 * week if that had one, else null (no streak running). Stored with the streak so a reader can tell, later, whether
 * the streak is still alive (see liveStreak).
 */
export function streakWeek(completedWeekKeys: readonly IsoDate[], currentWeek: IsoDate): IsoDate | null {
  const weeks = new Set(completedWeekKeys);
  if (weeks.has(currentWeek)) return currentWeek;
  const last = addDays(currentWeek, -7);
  return weeks.has(last) ? last : null;
}

/**
 * The stored streak as it stands in `currentWeek` (the viewer's Monday, in the client's time zone). A stored streak
 * is only written when a workout is awarded, so it never decays by itself: it is still alive while its last week is
 * this week or last week (this week is not over yet), and 0 once a whole week has ended without a workout.
 */
export function liveStreak(streak: number, lastWeek: IsoDate | null, currentWeek: IsoDate): number {
  if (streak <= 0 || !lastWeek) return 0;
  return lastWeek >= addDays(currentWeek, -7) ? streak : 0;
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
