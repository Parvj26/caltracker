import { formatWeight, type Units } from '../units/units';
import type { PersonalRecord, PrKind } from './prs';

/** How far back the client's Today screen looks for personal bests. */
export const RECENT_PR_DAYS = 7;
/** How many it lists. */
export const RECENT_PR_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: readonly PrKind[] = ['heaviest', 'reps_at_weight', 'e1rm'];
/** A lift that broke several records in one workout shows the one that reads as a real set first. */
const RANK: Record<PrKind, number> = { heaviest: 0, reps_at_weight: 1, e1rm: 2 };

/** The personal records listed in stored `awards.result` values (jsonb, so untyped). Anything malformed is skipped. */
export function awardRecords(results: readonly unknown[]): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue;
    const prs = (result as { prs?: unknown }).prs;
    if (!Array.isArray(prs)) continue;
    for (const p of prs as unknown[]) {
      if (typeof p !== 'object' || p === null) continue;
      const { exerciseId, kind, valueKg, reps, logId, achievedAt } = p as Record<string, unknown>;
      if (
        typeof exerciseId !== 'string' ||
        typeof logId !== 'string' ||
        typeof achievedAt !== 'string' ||
        Number.isNaN(Date.parse(achievedAt)) ||
        !KINDS.includes(kind as PrKind) ||
        typeof valueKg !== 'number' ||
        !(valueKg > 0) ||
        !(reps === null || reps === undefined || (typeof reps === 'number' && reps > 0))
      ) {
        continue;
      }
      out.push({ exerciseId, kind: kind as PrKind, valueKg, reps: typeof reps === 'number' ? reps : null, logId, achievedAt });
    }
  }
  return out;
}

/**
 * The client's newest personal bests from the last `days` days, newest first, one per exercise (its latest workout's
 * record, a heaviest or reps-at-weight record before an estimated max), at most `limit`.
 */
export function recentPrs(
  records: readonly PersonalRecord[],
  now: Date,
  days: number = RECENT_PR_DAYS,
  limit: number = RECENT_PR_LIMIT,
): PersonalRecord[] {
  const from = now.getTime() - days * DAY_MS;
  const best = new Map<string, PersonalRecord>();
  for (const r of records) {
    const at = Date.parse(r.achievedAt);
    if (at < from || at > now.getTime() + DAY_MS) continue;
    const have = best.get(r.exerciseId);
    if (!have) {
      best.set(r.exerciseId, r);
      continue;
    }
    const newer = at - Date.parse(have.achievedAt);
    const sameLog = r.logId === have.logId;
    if ((sameLog && RANK[r.kind] < RANK[have.kind]) || (!sameLog && newer > 0)) best.set(r.exerciseId, r);
  }
  return [...best.values()]
    .sort((a, b) => Date.parse(b.achievedAt) - Date.parse(a.achievedAt) || a.exerciseId.localeCompare(b.exerciseId))
    .slice(0, Math.max(0, limit));
}

/** "60 lb × 8" for a set, "80 kg est. max" for an estimated one-rep max, in the reader's units. */
export function recentPrAmount(pr: Pick<PersonalRecord, 'kind' | 'valueKg' | 'reps'>, units: Units): string {
  const weight = formatWeight(pr.valueKg, units);
  if (pr.kind === 'e1rm') return `${weight} est. max`;
  return pr.reps !== null ? `${weight} × ${pr.reps}` : weight;
}
