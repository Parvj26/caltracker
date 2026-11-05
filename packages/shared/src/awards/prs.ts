import type { WorkoutLogDoc } from '../logs/schema';

export type PrKind = 'heaviest' | 'reps_at_weight' | 'e1rm';

export type PersonalRecord = {
  exerciseId: string;
  kind: PrKind;
  valueKg: number;
  reps: number | null;
  logId: string;
  achievedAt: string;
};

/** Epley estimated one-rep max, to 1 decimal. */
export function epley1rm(weightKg: number, reps: number): number {
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

type Lift = { weightKg: number; reps: number; at: string };

function liftsByExercise(log: WorkoutLogDoc): Map<string, Lift[]> {
  const out = new Map<string, Lift[]>();
  for (const b of log.blocks) {
    for (const e of b.exercises) {
      if (e.trackingType !== 'weight_reps') continue;
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
 */
export function logBests(log: WorkoutLogDoc): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  for (const [exerciseId, lifts] of liftsByExercise(log)) {
    const rec = (kind: PrKind, valueKg: number, l: Lift): PersonalRecord => ({
      exerciseId,
      kind,
      valueKg,
      reps: l.reps,
      logId: log.id,
      achievedAt: l.at,
    });
    const heaviest = lifts.reduce((a, b) => (b.weightKg > a.weightKg || (b.weightKg === a.weightKg && b.reps > a.reps) ? b : a));
    out.push(rec('heaviest', heaviest.weightKg, heaviest));
    const e1 = lifts.reduce((a, b) => (epley1rm(b.weightKg, b.reps) > epley1rm(a.weightKg, a.reps) ? b : a));
    out.push(rec('e1rm', epley1rm(e1.weightKg, e1.reps), e1));
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
