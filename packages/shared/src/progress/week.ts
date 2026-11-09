import { trackedCount } from '../coach-home/client-overview';
import type { HomeWorkout } from '../coach-home/home';
import { workoutStatus } from '../coach-home/home';
import { addDays, diffDays, programEndDate, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

/**
 * The client's Progress tab, "This week" card: planned workouts done Monday to Sunday, new personal bests, the weekly
 * streak and one encouraging sentence. Never says what was missed: only what is done and what is still planned.
 */

export type WeekCounts = {
  /** Planned workouts this week that are done. */
  done: number;
  /** Every workout planned this week, Monday to Sunday (later days included: the week isn't over). */
  planned: number;
  /** Workouts the client added themselves this week. */
  extra: number;
  /** Lifts improved this week (prsThisWeek). */
  prs: number;
  /** The weekly streak as it stands now (liveStreak). */
  streak: number;
};

export type WeekSummary = WeekCounts & {
  /** "3/4", or the workouts done alone ("2") when nothing is planned. */
  workoutsValue: string;
  sentence: string;
};

export function thisWeekSummary(input: {
  workouts: readonly HomeWorkout[];
  /** Days the client finished workouts they added themselves. */
  addedDays: readonly IsoDate[];
  prs: number;
  streak: number;
  today: IsoDate;
}): WeekSummary {
  const monday = startOfWeek(input.today);
  const sunday = addDays(monday, 6);
  const inWeek = input.workouts.filter((w) => w.scheduledOn >= monday && w.scheduledOn <= sunday);
  const counts: WeekCounts = {
    done: inWeek.filter((w) => workoutStatus(w).kind === 'done').length,
    planned: inWeek.length,
    extra: trackedCount([], input.addedDays, monday, sunday, input.today).added,
    prs: input.prs,
    streak: input.streak,
  };
  return {
    ...counts,
    workoutsValue: counts.planned > 0 ? `${counts.done}/${counts.planned}` : String(counts.done + counts.extra),
    sentence: weekSentence(counts),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One short, upbeat sentence about the week so far. */
export function weekSentence(c: WeekCounts): string {
  const trained = c.done + c.extra > 0;
  if (c.planned > 0 && c.done >= c.planned) return 'Every planned workout done. Brilliant week.';
  if (trained && c.prs > 0) return `Strong week: ${plural(c.prs, 'new personal best', 'new personal bests')} so far.`;
  if (trained && c.planned > c.done) return `Nice work. ${c.planned - c.done} more planned this week.`;
  if (trained) return 'Nice work. Every workout counts.';
  if (c.streak > 0) return `One workout this week keeps your ${c.streak}-week streak going.`;
  return 'A new week. One workout gets you going.';
}

export type ProgramAssignmentLite = {
  programName: string;
  weeks: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  cancelledOn: IsoDate | null;
};

/**
 * "Strength Block · week 2 of 8" for the program running today (the latest started when two overlap), or null.
 * A program runs from its start to its end date (or start + weeks), unless it was cancelled on or before today.
 */
export function currentProgramLabel(assignments: readonly ProgramAssignmentLite[], today: IsoDate): string | null {
  const running = assignments
    .filter((a) => {
      const end = a.endDate ?? programEndDate(a.startDate, a.weeks);
      return a.startDate <= today && end >= today && !(a.cancelledOn !== null && a.cancelledOn <= today);
    })
    .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0];
  if (!running) return null;
  const week = Math.min(running.weeks, Math.floor(diffDays(running.startDate, today) / 7) + 1);
  return `${running.programName} · week ${week} of ${running.weeks}`;
}
