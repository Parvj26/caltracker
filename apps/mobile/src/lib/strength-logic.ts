// What the Progress tab shows for strength. Presentation only (no network, no React), so it is unit tested.
// The maths (estimated 1RM, warm-ups, best set) comes from @caltracker/shared.
import { addDays, diffDays, formatWeight, shortDate, strengthSummary, type StrengthPoint, type Units } from '@caltracker/shared';
import type { ChartPoint } from '@/components/charts/line-chart';

export type StrengthExercise = { exerciseId: string; name: string; points: StrengthPoint[] };
export type StrengthData = { exercises: StrengthExercise[] };

export const strengthCacheKey = (userId: string) => `caltracker.strength.${userId}`;

/** The saved series, or null when there is none or it is not readable. */
export function parseStrengthCache(raw: string | null): StrengthData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { exercises?: unknown };
    if (!Array.isArray(v.exercises)) return null;
    const ok = (v.exercises as unknown[]).every((e) => {
      const x = e as { exerciseId?: unknown; name?: unknown; points?: unknown };
      return typeof x?.exerciseId === 'string' && typeof x.name === 'string' && Array.isArray(x.points);
    });
    return ok ? (v as StrengthData) : null;
  } catch {
    return null;
  }
}

const EPOCH = '2000-01-01';

/** Chart points and texts for one exercise, in the client's units. */
export function chartModel(ex: StrengthExercise, units: Units) {
  return {
    points: ex.points.map<ChartPoint>((p) => ({
      x: diffDays(EPOCH, p.date),
      y: p.e1rmKg,
      label: `${shortDate(p.date)}: ${formatWeight(p.e1rmKg, units)} estimated 1RM, from ${formatWeight(p.bestSet.weightKg, units)} × ${p.bestSet.reps}`,
    })),
    summary: strengthSummary(ex.name, ex.points, units),
    yLabel: (y: number) => formatWeight(y, units),
    xLabel: (x: number) => shortDate(addDays(EPOCH, x)),
  };
}
