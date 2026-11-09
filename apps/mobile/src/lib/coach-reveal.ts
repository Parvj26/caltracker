// The sticker reveal for workouts the coach finished (rules in coach-reveal-logic.ts). The phone keeps, per user, the
// ids of the logs it has revealed, so each shows once on this phone. Never throws: without signal it tries next time.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAward } from './awards';
import { COACH_REVEAL_DAYS, awardCheckDue, coachRevealCandidates, parseRevealedIds, withRevealed, type CoachLoggedLog } from './coach-reveal-logic';
import { supabase } from './supabase';

const revealedKey = (userId: string) => `caltracker.coachRevealed.${userId}`;

// For this app session: logs whose award exists (it never goes away), and when a log last had none yet, so Today
// coming into view doesn't ask the server again each time (awardCheckDue).
const hasAward = new Set<string>();
const noAwardAt = new Map<string, number>();

async function awardExists(logId: string): Promise<boolean> {
  if (hasAward.has(logId)) return true;
  if (!awardCheckDue(noAwardAt.get(logId), Date.now())) return false;
  if (await fetchAward(logId)) {
    hasAward.add(logId);
    noAwardAt.delete(logId);
    return true;
  }
  noAwardAt.set(logId, Date.now());
  return false;
}

/** The coach-finished logs whose reveal this phone has shown (a tapped "Coach logged" push opens the rest). */
export async function revealedLogIds(userId: string): Promise<string[]> {
  try {
    return parseRevealedIds(await AsyncStorage.getItem(revealedKey(userId)));
  } catch {
    return [];
  }
}

/** Remembers that this coach-finished log's reveal has been shown on this phone. */
export async function markCoachRevealed(userId: string, logId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(revealedKey(userId), JSON.stringify(withRevealed(await revealedLogIds(userId), logId)));
  } catch {
    // Storage full or unavailable: at worst the reveal shows again.
  }
}

/**
 * The first coach-finished log of this client whose award the server has and this phone hasn't revealed, or null.
 * A log whose award doesn't exist yet is skipped this time and asked again next time.
 */
export async function nextCoachReveal(userId: string): Promise<string | null> {
  try {
    const since = new Date(Date.now() - COACH_REVEAL_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('workout_logs')
      .select('id, status, logged_by, finished_at')
      .eq('client_id', userId)
      .eq('status', 'completed')
      .neq('logged_by', userId)
      .gte('finished_at', since);
    if (error || !data) return null;
    const logs: CoachLoggedLog[] = data.map((r) => ({ id: r.id, status: r.status, loggedBy: r.logged_by, finishedAt: r.finished_at }));
    const revealed = new Set(await revealedLogIds(userId));
    for (const id of coachRevealCandidates(logs, userId, revealed, Date.now())) {
      if (await awardExists(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}
