// The sticker reveal for a workout the coach finished (single active logger). The phone never ran Finish for it,
// so the reveal shows the first time the client is on Today afterwards (or straight away when they were watching).
// Pure rules here; coach-reveal.ts reads the server and this phone's list of logs already revealed.
import type { LogStatus } from '@caltracker/shared';

/** Coach-finished workouts older than this are not revealed any more. */
export const COACH_REVEAL_DAYS = 14;
/** The phone keeps this many revealed log ids; older ones have long left the 14-day window. */
const KEEP_REVEALED = 200;

export type CoachLoggedLog = { id: string; status: LogStatus; loggedBy: string | null; finishedAt: string | null };

/**
 * The logs to reveal, oldest first: completed, finished by someone other than the client (their coach) in the last
 * COACH_REVEAL_DAYS, and not yet revealed on this phone. Whether the award exists yet is checked after (no award:
 * try again next time).
 */
export function coachRevealCandidates(logs: readonly CoachLoggedLog[], userId: string, revealed: ReadonlySet<string>, nowMs: number): string[] {
  const since = nowMs - COACH_REVEAL_DAYS * 86_400_000;
  return logs
    .flatMap((l) => {
      if (l.status !== 'completed' || l.loggedBy === null || l.loggedBy === userId || revealed.has(l.id)) return [];
      const at = l.finishedAt === null ? NaN : Date.parse(l.finishedAt);
      return Number.isNaN(at) || at < since ? [] : [{ id: l.id, at }];
    })
    .sort((a, b) => a.at - b.at)
    .map((l) => l.id);
}

/** The stored list of revealed log ids, or none when missing or unreadable. */
export function parseRevealedIds(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The list with this log id added once, keeping the newest KEEP_REVEALED. */
export function withRevealed(ids: readonly string[], logId: string): string[] {
  if (ids.includes(logId)) return [...ids];
  return [...ids, logId].slice(-KEEP_REVEALED);
}
