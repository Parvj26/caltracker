import { liftsByExercise, exerciseNames, heavierLift } from '../awards/prs';
import { loadStyleOf } from '../awards/load-style';
import type { LoadStyle } from '../awards/load-style';
import type { WorkoutLogDoc } from '../logs/schema';
import { fromKg, groupThousands } from '../units/units';
import type { Units } from '../units/units';
import { heaviestSessions, setText, type LiftSet } from './heaviest';
import type { StrengthPoint } from '../awards/strength-series';

/**
 * The workout summary's "Your progress" rows (product owner, 2026-11-19): each exercise's best set this workout (the
 * heaviest, by the same rule as Strength), how it compares with the last time it was done, and the "Heaviest yet" tag
 * from the same heaviestSessions rule the Strength screen uses, so the summary and Strength never disagree.
 */
export type SessionCompare = { text: string; tone: 'up' | 'down' | 'same' | 'first' };

const shown = (kg: number, units: Units) => Math.round(fromKg(kg, units) * 10) / 10;

/** "+2.5 kg vs last time", "+2 reps vs last time", "−5 kg vs last time", "Same as last time", "First time". */
export function compareWithLast(current: LiftSet, previous: LiftSet | null, units: Units, style: LoadStyle): SessionCompare {
  if (!previous) return { text: 'First time', tone: 'first' };
  const diff = Math.round((shown(current.weightKg, units) - shown(previous.weightKg, units)) * 10) / 10;
  if (diff !== 0) {
    // Assisted: less help is progress.
    const better = style === 'assisted' ? diff < 0 : diff > 0;
    const sign = diff > 0 ? '+' : '−';
    const word = style === 'assisted' ? ' assist' : '';
    return { text: `${sign}${groupThousands(String(Math.abs(diff)))} ${units}${word} vs last time`, tone: better ? 'up' : 'down' };
  }
  const reps = current.reps - previous.reps;
  if (reps === 0) return { text: 'Same as last time', tone: 'same' };
  return { text: `${reps > 0 ? '+' : '−'}${Math.abs(reps)} ${Math.abs(reps) === 1 ? 'rep' : 'reps'} vs last time`, tone: reps > 0 ? 'up' : 'down' };
}

export type SessionBestRow = {
  exerciseId: string;
  name: string;
  /** "60 kg × 8", "+5 kg × 6". */
  best: string;
  /** Null while earlier workouts aren't known (no signal and nothing saved on the phone). */
  compare: SessionCompare | null;
  heaviestYet: boolean;
};

/**
 * One row per exercise with a counted lift in `log` (weight and reps, not a warm-up), in workout order. `history` is
 * each exercise's strength series (oldest first) as last read, or null when unknown; this log's own point is taken
 * from the log itself, so the rows are right straight after Finish, before the server has the workout.
 */
export function sessionBestRows(
  log: WorkoutLogDoc,
  history: ReadonlyMap<string, readonly StrengthPoint[]> | null,
  units: Units,
): SessionBestRow[] {
  const names = exerciseNames(log);
  const finishedAt = log.finishedAt ?? log.lastActivityAt;
  const rows: SessionBestRow[] = [];
  for (const [exerciseId, lifts] of liftsByExercise(log)) {
    const name = names.get(exerciseId) ?? '';
    const style = loadStyleOf(name);
    const best = lifts.reduce((a, b) => (heavierLift(b, a, style) ? b : a));
    const set = { weightKg: best.weightKg, reps: best.reps };
    let compare: SessionCompare | null = null;
    let heaviestYet = false;
    const points = history?.get(exerciseId);
    if (history) {
      // Earlier workouts only (never this one, which may already be in the saved series).
      const earlier = (points ?? []).filter((p) => p.logId !== log.id && (p.date ?? '') <= finishedAt.slice(0, 10));
      const mine: StrengthPoint = { date: finishedAt.slice(0, 10), e1rmKg: 0, bestSet: set, heaviestSet: set, logId: log.id };
      const sessions = heaviestSessions([...earlier, mine], style);
      const prev = sessions.length > 1 ? sessions[sessions.length - 2]!.heaviest : null;
      compare = compareWithLast(set, prev, units, style);
      heaviestYet = sessions[sessions.length - 1]!.heaviestYet;
    }
    rows.push({ exerciseId, name, best: setText(set, units, style), compare, heaviestYet });
  }
  return rows;
}
