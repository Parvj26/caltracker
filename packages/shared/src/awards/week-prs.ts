import { addDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { localDay } from './streak';

/** One personal record from a finished workout, as listed in the award's stored result. */
export type PrEvent = { clientId: string; logId: string; exerciseId: string; achievedAt: string };

/** The PRs a stored `awards.result` (jsonb, so untyped) lists. Anything malformed is skipped. */
export function awardPrEvents(clientId: string, result: unknown): PrEvent[] {
  if (typeof result !== 'object' || result === null) return [];
  const prs = (result as { prs?: unknown }).prs;
  if (!Array.isArray(prs)) return [];
  const out: PrEvent[] = [];
  for (const p of prs as unknown[]) {
    if (typeof p !== 'object' || p === null) continue;
    const { logId, exerciseId, achievedAt } = p as Record<string, unknown>;
    if (typeof logId === 'string' && typeof exerciseId === 'string' && typeof achievedAt === 'string') {
      out.push({ clientId, logId, exerciseId, achievedAt });
    }
  }
  return out;
}

/**
 * The "New PRs this week" number on the coach home: personal records set from Monday to Sunday of the week that
 * `today` is in, with each day read in the coach's time zone (the same week as "Done this week"). It counts current
 * clients only. A lift that breaks several records in one workout (heaviest and estimated 1RM, say) counts once,
 * so the number is lifts improved, not records broken.
 */
export function prsThisWeek(events: readonly PrEvent[], currentClientIds: ReadonlySet<string>, today: IsoDate, timeZone: string): number {
  const start = startOfWeek(today);
  const end = addDays(start, 6);
  const seen = new Set<string>();
  for (const e of events) {
    if (!currentClientIds.has(e.clientId)) continue;
    const day = localDay(e.achievedAt, timeZone);
    if (day < start || day > end) continue;
    seen.add(`${e.clientId}|${e.logId}|${e.exerciseId}`);
  }
  return seen.size;
}
