import { countsWeightTimesReps } from '../workouts/targets';
import { liveExercises } from '../logs/flow';
import type { WorkoutLogDoc } from '../logs/schema';
import { E1RM_MAX_REPS, loadStyleOf } from './load-style';
import type { LoadStyle } from './load-style';

export type PrKind = 'heaviest' | 'reps_at_weight' | 'e1rm';

export type PersonalRecord = {
  exerciseId: string;
  kind: PrKind;
  valueKg: number;
  reps: number | null;
  logId: string;
  achievedAt: string;
};

/** Epley estimated one-rep max, to 1 decimal. A single is its own max (Epley would add 3%). */
export function epley1rm(weightKg: number, reps: number): number {
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/**
 * The estimated 1-rep max of one set, or null when there is none to give: a set of more than E1RM_MAX_REPS reps, or
 * an exercise whose logged weight is added to or taken off the body (load-style.ts). The one rule for PR tags, Personal
 * bests and Strength.
 */
export function estimate1rm(weightKg: number, reps: number, style: LoadStyle = 'weight'): number | null {
  if (style !== 'weight' || reps < 1 || reps > E1RM_MAX_REPS || weightKg <= 0) return null;
  return epley1rm(weightKg, reps);
}

/** The set with the best estimated 1-rep max among `lifts` (ties: the earlier), or null when none has one. */
export function bestE1rmLift<L extends { weightKg: number; reps: number }>(lifts: readonly L[], style: LoadStyle = 'weight'): { lift: L; kg: number } | null {
  let best: { lift: L; kg: number } | null = null;
  for (const l of lifts) {
    const kg = estimate1rm(l.weightKg, l.reps, style);
    if (kg !== null && (!best || kg > best.kg)) best = { lift: l, kg };
  }
  return best;
}

/** Whether lift `a` is heavier than `b`: more weight (less help when assisted), then more reps. */
export function heavierLift(a: { weightKg: number; reps: number }, b: { weightKg: number; reps: number }, style: LoadStyle = 'weight'): boolean {
  if (a.weightKg !== b.weightKg) return style === 'assisted' ? a.weightKg < b.weightKg : a.weightKg > b.weightKg;
  return a.reps > b.reps;
}

/** Each exercise's name in a log, by exercise id (the exercises being done). */
export function exerciseNames(log: WorkoutLogDoc): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of log.blocks) for (const { exercise: e } of liveExercises(b)) if (!out.has(e.exerciseId)) out.set(e.exerciseId, e.exerciseName);
  return out;
}

export type Lift = { weightKg: number; reps: number; at: string };

/**
 * Counted lifts per exercise: weight-and-reps sets that are finished, not warm-ups, with a weight and reps.
 * Only the exercises being done count: a pick-one group's unpicked options are left out.
 */
export function liftsByExercise(log: WorkoutLogDoc): Map<string, Lift[]> {
  const out = new Map<string, Lift[]>();
  for (const b of log.blocks) {
    for (const { exercise: e } of liveExercises(b)) {
      if (!countsWeightTimesReps(e.trackingType)) continue;
      for (const s of e.sets) {
        if (s.setType === 'warmup' || s.completedAt === null) continue;
        const weightKg = s.actualWeightKg ?? 0;
        const reps = s.actualReps ?? 0;
        if (weightKg <= 0 || reps <= 0) continue;
        const list = out.get(e.exerciseId) ?? [];
        list.push({ weightKg, reps, at: s.completedAt });
        out.set(e.exerciseId, list);
      }
    }
  }
  return out;
}

/**
 * The best lifts in a log, as records: heaviest weight, best estimated 1RM and most reps at each weight.
 * Warm-ups are left out. Store these for an exercise's first log: that is its baseline for later comparisons.
 * Assisted lifts (less help is better) get no heaviest record, so more help is never a PR; the estimated 1RM follows
 * estimate1rm (sets of 1–12 reps, plain weight only).
 */
export function logBests(log: WorkoutLogDoc): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  const names = exerciseNames(log);
  for (const [exerciseId, lifts] of liftsByExercise(log)) {
    const style = loadStyleOf(names.get(exerciseId) ?? '');
    const rec = (kind: PrKind, valueKg: number, l: Lift): PersonalRecord => ({
      exerciseId,
      kind,
      valueKg,
      reps: l.reps,
      logId: log.id,
      achievedAt: l.at,
    });
    if (style !== 'assisted') {
      const heaviest = lifts.reduce((a, b) => (heavierLift(b, a) ? b : a));
      out.push(rec('heaviest', heaviest.weightKg, heaviest));
    }
    const e1 = bestE1rmLift(lifts, style);
    if (e1) out.push(rec('e1rm', e1.kg, e1.lift));
    const byWeight = new Map<number, Lift>();
    for (const l of lifts) {
      const cur = byWeight.get(l.weightKg);
      if (!cur || l.reps > cur.reps) byWeight.set(l.weightKg, l);
    }
    for (const [w, l] of byWeight) out.push(rec('reps_at_weight', w, l));
  }
  return out;
}

/**
 * The records this log beats. `history` holds the existing records (baseline included). An exercise in
 * `firstLogOfExercise` is a baseline and yields nothing. A record only counts when it beats an existing one:
 * a weight never lifted before is a heaviest PR (if it is the top weight), not a reps-at-weight PR.
 */
export function detectPrs(
  log: WorkoutLogDoc,
  history: PersonalRecord[],
  firstLogOfExercise: ReadonlySet<string>,
): PersonalRecord[] {
  const prs: PersonalRecord[] = [];
  for (const cand of logBests(log)) {
    if (firstLogOfExercise.has(cand.exerciseId)) continue;
    const prior = history.filter((h) => h.exerciseId === cand.exerciseId && h.kind === cand.kind);
    if (cand.kind === 'reps_at_weight') {
      const same = prior.filter((h) => h.valueKg === cand.valueKg);
      if (same.length > 0 && (cand.reps ?? 0) > Math.max(...same.map((h) => h.reps ?? 0))) prs.push(cand);
    } else if (prior.length > 0 && cand.valueKg > Math.max(...prior.map((h) => h.valueKg))) {
      prs.push(cand);
    }
  }
  return prs;
}
