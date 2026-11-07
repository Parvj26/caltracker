import { addDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { workoutStatus } from './home';
import type { HomeWorkout } from './home';

/**
 * The client page's Overview: how much of the plan a client tracked lately, what's planned next week, and the
 * Updates feed. Dates are calendar dates in the coach's own time zone (`today` is the coach's today, as on Home), and
 * "done" means a completed log of the planned workout, as on Home.
 */

export type TrackedCount = {
  /** Planned workouts in the window that are done. */
  tracked: number;
  /** Planned workouts in the window. One planned for today counts only once done (today isn't over). */
  planned: number;
  /** Workouts the client added themselves in the window (not part of tracked or planned). */
  added: number;
};
export type TrainingSummary = { last7: TrackedCount; last30: TrackedCount; nextWeek: number };

function count(workouts: HomeWorkout[], addedOn: IsoDate[], today: IsoDate, days: number): TrackedCount {
  const from = addDays(today, -(days - 1));
  let tracked = 0;
  let planned = 0;
  for (const w of workouts) {
    if (w.scheduledOn < from || w.scheduledOn > today) continue;
    const isDone = workoutStatus(w).kind === 'done';
    if (w.scheduledOn === today && !isDone) continue;
    planned += 1;
    if (isDone) tracked += 1;
  }
  const added = addedOn.filter((d) => d >= from && d <= today).length;
  return { tracked, planned, added };
}

/**
 * Last 7 days (6 days ago up to today), last 30 days (29 days ago up to today), and the number of workouts planned
 * for next week, Monday to Sunday. `workouts` are one client's planned workouts; `addedOn` are the days the client
 * finished workouts they added themselves.
 */
export function trainingSummary(workouts: HomeWorkout[], addedOn: IsoDate[], today: IsoDate): TrainingSummary {
  const nextMonday = addDays(startOfWeek(today), 7);
  const nextSunday = addDays(nextMonday, 6);
  return {
    last7: count(workouts, addedOn, today, 7),
    last30: count(workouts, addedOn, today, 30),
    nextWeek: workouts.filter((w) => w.scheduledOn >= nextMonday && w.scheduledOn <= nextSunday).length,
  };
}

export type ClientUpdateKind = 'workout' | 'scan' | 'weight' | 'sticker';
export type ClientUpdate = { id: string; kind: ClientUpdateKind; at: string; text: string; href?: string };

/** Newest first (ties by id, so the order is stable), at most `limit`. */
export function latestUpdates(updates: readonly ClientUpdate[], limit: number): ClientUpdate[] {
  return [...updates]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

/** How long ago, in the feed's short form: "now", "5m", "3h", "6d", "2w", "1y". A time in the future is "now". */
export function ageLabel(iso: string, now: Date): string {
  const s = Math.floor((now.getTime() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 365)}y`;
}
