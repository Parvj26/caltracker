import { trackedCount } from '../coach-home/client-overview';
import type { HomeWorkout } from '../coach-home/home';
import { workoutStatus } from '../coach-home/home';
import { addDays, monthGrid, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { formatShortDate } from '../body/series';

/**
 * The client's Consistency screen: planned workouts done per week over the last 8 weeks, the share done, and this
 * month's calendar. The words never say "missed": a week with nothing done is just a week, a rest day is just rest.
 */

export const CONSISTENCY_WEEKS = 8;

/** all: every planned workout done (or, with nothing planned, some workouts done); some: part; none; rest: no plan. */
export type WeekState = 'all' | 'some' | 'none' | 'rest';

export type ConsistencyWeek = {
  monday: IsoDate;
  planned: number;
  done: number;
  extra: number;
  state: WeekState;
  /** "3/4", or the workouts done alone ("2") when nothing was planned. */
  count: string;
  /** "w1" … "w7", "now". */
  short: string;
  /** For a screen reader: "Week of 12 Oct: 3 of 4 planned workouts done". */
  label: string;
};

/** The last `weeks` weeks, oldest first, ending with this week (counted whole: its later days are still planned). */
export function consistencyWeeks(
  workouts: readonly HomeWorkout[],
  addedDays: readonly IsoDate[],
  today: IsoDate,
  weeks = CONSISTENCY_WEEKS,
): ConsistencyWeek[] {
  const thisMonday = startOfWeek(today);
  return Array.from({ length: weeks }, (_, i) => {
    const monday = addDays(thisMonday, -7 * (weeks - 1 - i));
    const sunday = addDays(monday, 6);
    const inWeek = workouts.filter((w) => w.scheduledOn >= monday && w.scheduledOn <= sunday);
    const planned = inWeek.length;
    const done = inWeek.filter((w) => workoutStatus(w).kind === 'done').length;
    const extra = addedDays.filter((d) => d >= monday && d <= sunday).length;
    const state: WeekState =
      planned === 0 ? (extra > 0 ? 'all' : 'rest') : done >= planned ? 'all' : done + extra > 0 ? 'some' : 'none';
    const isNow = i === weeks - 1;
    const when = isNow ? 'This week' : `Week of ${formatShortDate(monday, today)}`;
    const extraText = extra > 0 ? `, plus ${extra} extra` : '';
    const label =
      planned > 0
        ? `${when}: ${done} of ${planned} planned workouts done${extraText}`
        : `${when}: ${extra === 1 ? '1 workout' : `${extra} workouts`} done`;
    return { monday, planned, done, extra, state, count: planned > 0 ? `${done}/${planned}` : String(extra), short: isNow ? 'now' : `w${i + 1}`, label };
  });
}

/** The share (0–100) of planned workouts done over the last `weeks` weeks up to today, or null when none were planned. */
export function plannedDonePercent(
  workouts: readonly HomeWorkout[],
  addedDays: readonly IsoDate[],
  today: IsoDate,
  weeks = CONSISTENCY_WEEKS,
): number | null {
  const from = addDays(startOfWeek(today), -7 * (weeks - 1));
  const c = trackedCount(workouts, addedDays, from, today, today);
  return c.planned === 0 ? null : Math.round((c.tracked / c.planned) * 100);
}

/** The Consistency tile on Progress. `workoutsDone` is every workout finished in the same 8 weeks. */
export function consistencyTile(percent: number | null, workoutsDone: number): { value: string; sub: string } {
  if (percent !== null) return { value: `${percent}%`, sub: `planned done · ${CONSISTENCY_WEEKS} weeks` };
  return { value: workoutsDone === 1 ? '1 workout' : `${workoutsDone} workouts`, sub: `last ${CONSISTENCY_WEEKS} weeks` };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type CalendarDay = {
  date: IsoDate;
  day: number;
  inMonth: boolean;
  trained: boolean;
  isToday: boolean;
  future: boolean;
  /** "2 November, workout done", "5 November, today". */
  label: string;
};

/** This month, Monday first (the app's weeks), with the days a workout was finished. */
export function monthCalendar(
  trainedDays: readonly IsoDate[],
  today: IsoDate,
): { title: string; weekdays: string[]; rows: CalendarDay[][] } {
  const trained = new Set(trainedDays);
  const month = today.slice(0, 7);
  const name = (d: IsoDate) => MONTH_NAMES[Number(d.slice(5, 7)) - 1] ?? '';
  const rows = monthGrid(month).map((week) =>
    week.map((date): CalendarDay => {
      const day = Number(date.slice(8, 10));
      const did = trained.has(date);
      const isToday = date === today;
      const parts = [`${day} ${name(date)}`];
      if (did) parts.push('workout done');
      if (isToday) parts.push('today');
      return { date, day, inMonth: date.slice(0, 7) === month, trained: did, isToday, future: date > today, label: parts.join(', ') };
    }),
  );
  return { title: `${name(today)} ${today.slice(0, 4)}`, weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], rows };
}
