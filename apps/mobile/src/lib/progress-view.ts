// Small compositions of shared rules for the Progress screens. Pure, so it is unit tested.
import { liveStreak, startOfWeek, streakWeeks, type IsoDate } from '@caltracker/shared';
import type { AlbumStats } from './album-logic';

/**
 * The weekly streak now and the best one: the stored streak (as the Zoo book shows it) when the server has one, else
 * worked out from the finished workouts on this phone.
 */
export function streakNow(stats: AlbumStats | null, trainedDays: readonly IsoDate[], today: IsoDate): { current: number; best: number } {
  const week = startOfWeek(today);
  if (stats) return { current: liveStreak(stats.streak, stats.streakWeek, week), best: stats.bestStreak };
  return streakWeeks(trainedDays.map(startOfWeek), week);
}
