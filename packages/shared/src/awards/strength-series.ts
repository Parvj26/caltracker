import { formatWeight } from '../units/units';
import type { Units } from '../units/units';
import type { IsoDate } from '../dates/dates';
import type { WorkoutLogDoc } from '../logs/schema';
import { epley1rm, liftsByExercise } from './prs';
import { localDay } from './streak';

export type StrengthPoint = {
  date: IsoDate;
  e1rmKg: number;
  /** The set with the highest estimated 1RM in that workout. */
  bestSet: { weightKg: number; reps: number };
};

/** The finished logs that have a counted set (no warm-ups) of the exercise, with that log's best lift. */
function points(logs: readonly WorkoutLogDoc[], exerciseId: string, timeZone: string): Array<StrengthPoint & { at: string }> {
  const out: Array<StrengthPoint & { at: string }> = [];
  for (const log of logs) {
    if (log.status !== 'completed' || !log.finishedAt) continue;
    const lifts = liftsByExercise(log).get(exerciseId);
    if (!lifts || lifts.length === 0) continue;
    const best = lifts.reduce((a, b) => (epley1rm(b.weightKg, b.reps) > epley1rm(a.weightKg, a.reps) ? b : a));
    out.push({
      date: localDay(log.finishedAt, timeZone),
      at: log.finishedAt,
      e1rmKg: epley1rm(best.weightKg, best.reps),
      bestSet: { weightKg: best.weightKg, reps: best.reps },
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * One point per finished workout for the exercise: that day's best estimated 1RM and the set it came from, oldest
 * first. Warm-ups and unfinished sets are left out. `timeZone` decides which calendar day a workout belongs to.
 */
export function strengthSeries(logs: readonly WorkoutLogDoc[], exerciseId: string, timeZone = 'UTC'): StrengthPoint[] {
  return points(logs, exerciseId, timeZone).map((p) => ({ date: p.date, e1rmKg: p.e1rmKg, bestSet: p.bestSet }));
}

/** The exercises that have a strength series in these logs, sorted by name, for the exercise dropdown. */
export function strengthExercises(logs: readonly WorkoutLogDoc[]): Array<{ exerciseId: string; name: string }> {
  const names = new Map<string, string>();
  for (const log of logs) {
    if (log.status !== 'completed' || !log.finishedAt) continue;
    const counted = liftsByExercise(log);
    for (const b of log.blocks) for (const e of b.exercises) if (counted.has(e.exerciseId) && !names.has(e.exerciseId)) names.set(e.exerciseId, e.exerciseName);
  }
  return [...names]
    .map(([exerciseId, name]) => ({ exerciseId, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.exerciseId.localeCompare(b.exerciseId));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "3 Nov" from a YYYY-MM-DD date. */
export function shortDate(d: IsoDate): string {
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}`;
}

/** A sentence for the chart's text alternative: how the estimated 1RM moved and its best. */
export function strengthSummary(name: string, points: readonly StrengthPoint[], units: Units): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return `${name}: no workouts yet.`;
  const count = `${points.length} ${points.length === 1 ? 'workout' : 'workouts'}`;
  if (points.length === 1) return `${name}: ${count}. Estimated 1RM ${formatWeight(first.e1rmKg, units)} on ${shortDate(first.date)}.`;
  const change = last.e1rmKg - first.e1rmKg;
  const trend = change === 0 ? 'no change' : `${change > 0 ? 'up' : 'down'} ${formatWeight(Math.abs(change), units)}`;
  const best = points.reduce((a, b) => (b.e1rmKg > a.e1rmKg ? b : a));
  return `${name}: ${count}. Estimated 1RM went from ${formatWeight(first.e1rmKg, units)} on ${shortDate(first.date)} to ${formatWeight(last.e1rmKg, units)} on ${shortDate(last.date)}, ${trend}. Best ${formatWeight(best.e1rmKg, units)} on ${shortDate(best.date)}.`;
}
