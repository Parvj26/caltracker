import { programDayToDate } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

/** A day the program would put a workout on that already has one or more workouts for the client. */
export type ProgramClash = { date: IsoDate; names: string[] };

/**
 * The days where assigning `program` from `start` would land on a day the client already has workouts on, in date
 * order, each with the names already there. Slots beyond the program's length are not copied, so they never clash.
 */
export function programClashes(
  program: { weeks: number; slots: readonly { week: number; day: number }[] },
  start: IsoDate,
  existing: readonly { date: IsoDate; name: string }[],
): ProgramClash[] {
  const landing = new Set(program.slots.filter((s) => s.week <= program.weeks).map((s) => programDayToDate(start, s.week, s.day)));
  const byDate = new Map<IsoDate, string[]>();
  for (const w of existing) {
    if (landing.has(w.date)) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w.name]);
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, names]) => ({ date, names }));
}
