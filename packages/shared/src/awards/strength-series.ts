import type { IsoDate } from '../dates/dates';
import { MONTHS_SHORT } from '../dates/format';
import type { WorkoutLogDoc } from '../logs/schema';
import { loadStyleOf } from './load-style';
import { bestE1rmLift, epley1rm, exerciseNames, heavierLift, liftsByExercise } from './prs';
import { localDay } from './streak';

export type StrengthPoint = {
  date: IsoDate;
  /** The best estimated 1RM in that workout (see `e1rm`; when it has none, the heaviest set's Epley, for old screens). */
  e1rmKg: number;
  /** The set `e1rmKg` came from. */
  bestSet: { weightKg: number; reps: number };
  /**
   * The best estimated 1-rep max by the one rule (prs.ts estimate1rm: sets of 1–12 reps, plain weight only), or null
   * when the workout has none. The heaviest set in that workout (most reps breaks a tie), its log and the workout's
   * name. All optional: series saved on a phone before these existed have none (read heaviestSet as bestSet then).
   */
  e1rm?: { kg: number; set: { weightKg: number; reps: number } } | null;
  heaviestSet?: { weightKg: number; reps: number };
  logId?: string;
  logName?: string;
};

/**
 * Every exercise's series at once (each log's counted sets are read once): one point per finished workout with a
 * counted set (no warm-ups) of the exercise, oldest first. `timeZone` decides which calendar day a workout belongs to.
 */
export function strengthSeriesAll(logs: readonly WorkoutLogDoc[], timeZone = 'UTC'): Map<string, StrengthPoint[]> {
  const out = new Map<string, Array<StrengthPoint & { at: string }>>();
  for (const log of logs) {
    if (log.status !== 'completed' || !log.finishedAt) continue;
    const names = exerciseNames(log);
    for (const [exerciseId, lifts] of liftsByExercise(log)) {
      if (lifts.length === 0) continue;
      const style = loadStyleOf(names.get(exerciseId) ?? '');
      const heaviest = lifts.reduce((a, b) => (heavierLift(b, a, style) ? b : a));
      const e1 = bestE1rmLift(lifts, style);
      const best = e1?.lift ?? heaviest;
      const list = out.get(exerciseId) ?? [];
      list.push({
        date: localDay(log.finishedAt, timeZone),
        at: log.finishedAt,
        e1rmKg: e1?.kg ?? epley1rm(heaviest.weightKg, heaviest.reps),
        bestSet: { weightKg: best.weightKg, reps: best.reps },
        e1rm: e1 ? { kg: e1.kg, set: { weightKg: e1.lift.weightKg, reps: e1.lift.reps } } : null,
        heaviestSet: { weightKg: heaviest.weightKg, reps: heaviest.reps },
        logId: log.id,
        logName: log.name,
      });
      out.set(exerciseId, list);
    }
  }
  return new Map([...out].map(([id, list]) => [id, list.sort((a, b) => a.at.localeCompare(b.at)).map(withoutAt)]));
}

function withoutAt(p: StrengthPoint & { at: string }): StrengthPoint {
  const { at, ...rest } = p;
  void at;
  return rest;
}

/** One exercise's series (strengthSeriesAll); call strengthSeriesAll when you need several. */
export function strengthSeries(logs: readonly WorkoutLogDoc[], exerciseId: string, timeZone = 'UTC'): StrengthPoint[] {
  return strengthSeriesAll(logs, timeZone).get(exerciseId) ?? [];
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

/** "3 Nov" from a YYYY-MM-DD date. */
export function shortDate(d: IsoDate): string {
  return `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1] ?? ''}`;
}

