import type { PrKind } from './prs';

/** A stored personal record with its exercise's name (the coach page's read of `personal_records`). */
export type NamedRecord = {
  exerciseId: string;
  name: string;
  kind: PrKind;
  valueKg: number;
  reps: number | null;
  achievedAt: string;
};

export type PersonalBestRow = {
  exerciseId: string;
  name: string;
  /** The heaviest set, weight and the reps done at it. */
  weightKg: number | null;
  reps: number | null;
  e1rmKg: number | null;
  /** When the heaviest set (or, without one, the e1RM) was done. */
  achievedAt: string;
};

/** One row per exercise for the Personal bests table, sorted by exercise name. Reps-at-weight records are not shown. */
export function personalBestRows(records: readonly NamedRecord[]): PersonalBestRow[] {
  const byExercise = new Map<string, PersonalBestRow>();
  for (const r of records) {
    if (r.kind === 'reps_at_weight') continue;
    const row = byExercise.get(r.exerciseId) ?? {
      exerciseId: r.exerciseId,
      name: r.name,
      weightKg: null,
      reps: null,
      e1rmKg: null,
      achievedAt: r.achievedAt,
    };
    if (r.kind === 'heaviest') {
      row.weightKg = r.valueKg;
      row.reps = r.reps;
      row.achievedAt = r.achievedAt;
    } else {
      row.e1rmKg = r.valueKg;
      if (row.weightKg === null) row.achievedAt = r.achievedAt;
    }
    byExercise.set(r.exerciseId, row);
  }
  return [...byExercise.values()].sort((a, b) => a.name.localeCompare(b.name) || a.exerciseId.localeCompare(b.exerciseId));
}

/** Whether a stored `awards.result` (jsonb, so untyped) lists any personal best. */
export function awardHasPrs(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const prs = (result as { prs?: unknown }).prs;
  return Array.isArray(prs) && prs.length > 0;
}

export function streakLabel(weeks: number): string {
  return weeks > 0 ? `${weeks}-week streak` : 'No streak yet';
}
