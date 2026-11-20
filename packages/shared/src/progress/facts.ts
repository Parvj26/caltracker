import { personalBestRows, type NamedRecord } from '../awards/bests';
import { STICKERS } from '../awards/catalogue';
import { liveStreak, streakWeeks } from '../awards/streak';
import { liftsImprovedBetween, prsThisWeek, type PrEvent } from '../awards/week-prs';
import type { HomeWorkout } from '../coach-home/home';
import { addDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { formatWeight } from '../units/units';
import type { Units } from '../units/units';
import { thisWeekSummary, type WeekSummary } from './week';

/**
 * The client's progress numbers, worked out in ONE place (product owner, 2026-11-19): the streak, personal bests,
 * stickers and "this week" that Today, the Progress tab, Consistency and the Zoo book all show. Each screen reads these
 * facts, so they can never disagree. The streak is the server's stored one (client_stats) when there is one, else
 * worked out from the finished workouts on the phone. While the latest workout is still syncing or being awarded the
 * facts say `updating`, and the screens show "Updating…" instead of a number that is about to change ("None yet").
 */

/** A finished workout as the Progress data keeps it. `at`, `logId` and `awarded` are missing in copies saved before them. */
export type FinishedLite = { day: IsoDate; planned: boolean; at?: string; logId?: string; awarded?: boolean };

export type StoredStreak = { streak: number; streakWeek: IsoDate | null; bestStreak: number };

export type StickerLite = { key: string; shiny: boolean; firstEarnedAt: string };

/** How long after finishing a workout with no award yet the numbers count as "updating" (the server's catch-up job runs every 15 minutes). */
export const AWARD_SETTLE_MS = 30 * 60 * 1000;

export type ProgressFactsInput = {
  /** The training data (null until loaded). */
  hub: {
    finished: readonly FinishedLite[];
    workouts: readonly HomeWorkout[];
    records: readonly NamedRecord[];
    prEvents: readonly PrEvent[];
  } | null;
  /** The sticker book (null until loaded); `stats` is null before the first award. */
  album: { stickers: readonly StickerLite[]; stats: StoredStreak | null } | null;
  /** A finished workout is still on this phone, waiting to upload. */
  uploading: boolean;
  userId: string | null;
  today: IsoDate;
  timeZone: string;
  units: Units;
  nowMs: number;
};

export type ProgressFacts = {
  /** The latest workout is still syncing or being awarded: show "Updating…", not the numbers below. */
  updating: boolean;
  /** Null until the training data is in. */
  streak: { current: number; best: number } | null;
  week: WeekSummary | null;
  bests: {
    /** Lifts improved this calendar month (a lift counts once per workout). */
    thisMonth: number;
    /** Exercises with a stored best. */
    total: number;
    /** The newest best: "Barbell Squat", "62.5 kg × 8". */
    latest: { exerciseId: string; name: string; value: string } | null;
  } | null;
  /** Null until the sticker book is in. */
  stickers: { count: number; newest: { key: string; name: string; shiny: boolean } | null } | null;
};

const stickerByKey = new Map(STICKERS.map((s) => [s.key, s]));

/** A workout finished within AWARD_SETTLE_MS that the server has not awarded yet. */
export function awaitingAward(finished: readonly FinishedLite[], nowMs: number): boolean {
  return finished.some((f) => f.awarded === false && f.at !== undefined && nowMs - Date.parse(f.at) < AWARD_SETTLE_MS);
}

/** The streak now and the best: the stored one as it stands this week, else from the finished workouts' days. */
export function streakFrom(stats: StoredStreak | null, trainedDays: readonly IsoDate[], today: IsoDate): { current: number; best: number } {
  const week = startOfWeek(today);
  if (stats) return { current: liveStreak(stats.streak, stats.streakWeek, week), best: stats.bestStreak };
  return streakWeeks(trainedDays.map(startOfWeek), week);
}

export function progressFacts(input: ProgressFactsInput): ProgressFacts {
  const { hub, album, today, timeZone, units } = input;
  const updating = input.uploading || (hub !== null && awaitingAward(hub.finished, input.nowMs));
  const trained = hub ? hub.finished.map((f) => f.day) : [];
  const streak = hub ? streakFrom(album?.stats ?? null, trained, today) : null;
  const prs = hub && input.userId ? prsThisWeek(hub.prEvents, new Set([input.userId]), today, timeZone) : 0;
  const week = hub
    ? thisWeekSummary({
        workouts: hub.workouts,
        addedDays: hub.finished.filter((f) => !f.planned).map((f) => f.day),
        prs,
        streak: streak?.current ?? 0,
        today,
      })
    : null;

  let bests: ProgressFacts['bests'] = null;
  if (hub) {
    const rows = personalBestRows(hub.records);
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = addDays(`${addDays(monthStart, 31).slice(0, 7)}-01`, -1);
    const newest = [...rows].sort((a, b) => b.achievedAt.localeCompare(a.achievedAt) || a.name.localeCompare(b.name))[0];
    bests = {
      thisMonth: liftsImprovedBetween(hub.prEvents, monthStart, monthEnd, timeZone),
      total: rows.length,
      latest: newest
        ? {
            exerciseId: newest.exerciseId,
            name: newest.name,
            value:
              newest.weightKg !== null
                ? newest.reps !== null
                  ? `${formatWeight(newest.weightKg, units)} × ${newest.reps}`
                  : formatWeight(newest.weightKg, units)
                : `${formatWeight(newest.e1rmKg ?? 0, units)} est. max`,
          }
        : null,
    };
  }

  let stickers: ProgressFacts['stickers'] = null;
  if (album) {
    const known = album.stickers.filter((s) => stickerByKey.has(s.key));
    let newest: StickerLite | null = null;
    for (const s of known) if (!newest || Date.parse(s.firstEarnedAt) > Date.parse(newest.firstEarnedAt)) newest = s;
    stickers = {
      count: known.length,
      newest: newest ? { key: newest.key, name: stickerByKey.get(newest.key)?.name ?? newest.key, shiny: newest.shiny } : null,
    };
  }

  return { updating, streak, week, bests, stickers };
}

export const UPDATING = 'Updating…';

/**
 * The streak in words. Never says a streak was lost (product owner, 2026-11-19): with no streak running after one
 * before, it is a new journey (the landmarks stay in the book).
 */
export function streakWords(streak: { current: number; best: number }, everTrained: boolean): { title: string; line: string | null } {
  if (streak.current > 0) return { title: `${streak.current}-week streak`, line: null };
  if (streak.best > 0 || everTrained) return { title: 'A new journey', line: 'Your landmarks stay in your book. One workout this week starts your next streak.' };
  return { title: 'Your journey starts here', line: 'One workout this week starts your streak.' };
}

/** "3 of 4 this week", "2 workouts this week", "Nothing planned yet this week". */
export function weekWords(week: Pick<WeekSummary, 'done' | 'planned' | 'extra'>): string {
  if (week.planned > 0) return `${week.done} of ${week.planned} this week${week.extra > 0 ? ` +${week.extra}` : ''}`;
  const n = week.done + week.extra;
  if (n === 0) return 'Nothing planned yet this week';
  return `${n} ${n === 1 ? 'workout' : 'workouts'} this week`;
}

export type HubRow = { value: string; sub: string };

const updatingRow: HubRow = { value: UPDATING, sub: 'Your latest workout is still syncing' };

/** The Progress hub's Personal bests row: "3 this month" · "Latest: Barbell Squat 62.5 kg × 8". */
export function bestsRow(facts: ProgressFacts): HubRow | null {
  if (!facts.bests) return null;
  if (facts.updating) return updatingRow;
  const { thisMonth, total, latest } = facts.bests;
  if (total === 0 || !latest) return { value: 'None yet', sub: 'Finish a workout to set one' };
  return {
    value: thisMonth > 0 ? `${thisMonth} this month` : `${total} ${total === 1 ? 'best' : 'bests'}`,
    sub: `Latest: ${latest.name} ${latest.value}`,
  };
}

/** The Progress hub's Consistency row: "3 of 4 this week" · "2-week streak". */
export function consistencyRow(facts: ProgressFacts, everTrained: boolean): HubRow | null {
  if (!facts.week || !facts.streak) return null;
  if (facts.updating) return updatingRow;
  const words = streakWords(facts.streak, everTrained);
  return { value: weekWords(facts.week), sub: facts.streak.current > 0 ? words.title : (words.line ?? words.title) };
}

/** The Progress hub's Zoo book row: "7 stickers" · "Newest: Polar bear". */
export function zooRow(facts: ProgressFacts): HubRow | null {
  if (!facts.stickers) return null;
  if (facts.updating) return updatingRow;
  const { count, newest } = facts.stickers;
  if (count === 0 || !newest) return { value: 'No stickers yet', sub: 'Finish a workout to earn one' };
  return { value: count === 1 ? '1 sticker' : `${count} stickers`, sub: `Newest: ${newest.name}` };
}

/** The line under the Progress title: "2-week streak · 3 of 4 workouts this week" (strong part first). */
export function progressHeadline(facts: ProgressFacts, everTrained: boolean): { strong: string; rest: string | null } | null {
  if (!facts.week || !facts.streak) return null;
  if (facts.updating) return { strong: UPDATING, rest: 'your latest workout is still syncing' };
  const words = streakWords(facts.streak, everTrained);
  const w = facts.week;
  const rest =
    w.planned > 0
      ? `${w.done} of ${w.planned} ${w.planned === 1 ? 'workout' : 'workouts'} this week`
      : w.done + w.extra > 0
        ? `${w.done + w.extra} ${w.done + w.extra === 1 ? 'workout' : 'workouts'} this week`
        : null;
  return { strong: words.title, rest };
}
