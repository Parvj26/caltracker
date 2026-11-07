import { addDays, programDayToDate } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

// Program Live Sync (spec: docs/superpowers/specs/2026-11-06-live-sync-design.md). The database does the sync
// (live_sync_program in supabase/migrations/20261106007000_live_sync.sql); planLiveSync is the same rule as a pure
// function, so the rule is written down and tested in one place and the two can be checked against each other.

export type LiveSyncAssignment = { startDate: IsoDate; endDate: IsoDate; cancelledOn: IsoDate | null };

/**
 * The days Live Sync may change for an assignment: from the client's today (or the start date, if later) to the day
 * before the cancel date (open-ended when not cancelled). Null when the assignment ended before today or was
 * cancelled from today or earlier: it is not active, so nothing changes.
 */
export function liveSyncWindow(a: LiveSyncAssignment, today: IsoDate): { from: IsoDate; until: IsoDate | null } | null {
  if (a.endDate < today || (a.cancelledOn !== null && a.cancelledOn <= today)) return null;
  const from = a.startDate > today ? a.startDate : today;
  const until = a.cancelledOn === null ? null : addDays(a.cancelledOn, -1);
  return { from, until };
}

export type LiveSyncSlot = { week: number; day: number; position: number; workoutId: string };

/** A workout on the client's calendar that came from the assignment. */
export type LiveSyncCopy = {
  id: string;
  /** The program day it was copied for (planned_on). Moving the copy never changes it. */
  plannedOn: IsoDate;
  /** The day it is on now (scheduled_on). */
  date: IsoDate;
  /** The library workout it was copied from; null once that was deleted. */
  workoutId: string | null;
  /** The library content it was copied from (source_hash); null for copies made before Live Sync. */
  hash: string | null;
  /** Edited by the coach for this client since it was assigned. */
  customised: boolean;
  /** Has an in-progress or completed log (a discarded one doesn't count). */
  logged: boolean;
};

export type LiveSyncPlan = {
  add: { date: IsoDate; workoutId: string }[];
  remove: string[];
  /** Out-of-date copies to refresh in place with the library workout's current content (same row and id). */
  replace: string[];
  /** Customised copies left as they were although the program differs. */
  skipped: number;
};

/**
 * What Live Sync does to one assignment (live_sync_program in the database does the same).
 *
 * Wanted (day, workout) pairs come from the slots inside the program's length and the window; copies are paired with
 * them by (program day, workout, n-th), protected copies (logged or customised) first. Then:
 * - an unpaired wanted pair is added (from today on), unless the coach deleted that day's copy (`tombstones`) or the
 *   day has a started or done copy the program no longer has;
 * - an unpaired untouched copy is removed, and a paired untouched copy whose library content changed is refreshed,
 *   only when both its days are after today;
 * - protected copies are never changed; customised ones that differ (after today) are counted as skipped.
 */
export function planLiveSync(input: {
  assignment: LiveSyncAssignment;
  weeks: number;
  slots: readonly LiveSyncSlot[];
  /** Current content hash of each library workout the slots use. */
  hashes: Readonly<Record<string, string>>;
  copies: readonly LiveSyncCopy[];
  /** "day|workoutId" of program days the coach deleted from this client's calendar. */
  tombstones?: ReadonlySet<string>;
  today: IsoDate;
}): LiveSyncPlan {
  const plan: LiveSyncPlan = { add: [], remove: [], replace: [], skipped: 0 };
  const window = liveSyncWindow(input.assignment, input.today);
  if (!window) return plan;
  const inside = (d: IsoDate) => d >= window.from && (window.until === null || d <= window.until);
  const afterToday = (c: LiveSyncCopy) => c.plannedOn > input.today && c.date > input.today;

  const wanted = input.slots
    .filter((s) => s.week <= input.weeks)
    .map((s) => ({ ...s, date: programDayToDate(input.assignment.startDate, s.week, s.day) }))
    .filter((s) => inside(s.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.position - b.position));

  const key = (date: IsoDate, workoutId: string | null) => `${date}|${workoutId ?? ''}`;
  const queues = new Map<string, LiveSyncCopy[]>();
  for (const c of input.copies.filter((c) => inside(c.plannedOn))) {
    const list = queues.get(key(c.plannedOn, c.workoutId)) ?? [];
    list.push(c);
    queues.set(key(c.plannedOn, c.workoutId), list);
  }
  const isProtected = (c: LiveSyncCopy) => c.customised || c.logged;
  for (const list of queues.values()) list.sort((a, b) => Number(isProtected(b)) - Number(isProtected(a)));

  const toAdd: { date: IsoDate; workoutId: string }[] = [];
  const changeOrSkip = (c: LiveSyncCopy, change: string[]) => {
    if (c.logged || !afterToday(c)) return;
    if (c.customised) plan.skipped += 1;
    else change.push(c.id);
  };
  for (const w of wanted) {
    const match = queues.get(key(w.date, w.workoutId))?.shift();
    if (!match) toAdd.push({ date: w.date, workoutId: w.workoutId });
    else if (match.hash !== (input.hashes[w.workoutId] ?? null)) changeOrSkip(match, plan.replace);
  }
  const daysWithDroppedLog = new Set<IsoDate>();
  for (const list of queues.values()) {
    for (const c of list) {
      if (c.logged) daysWithDroppedLog.add(c.plannedOn);
      changeOrSkip(c, plan.remove);
    }
  }
  plan.add = toAdd.filter((a) => !daysWithDroppedLog.has(a.date) && !input.tombstones?.has(key(a.date, a.workoutId)));
  return plan;
}

/**
 * The "Live" tag on a client's calendar: a workout of a live program that Live Sync will still keep up to date
 * (after today, not started or done, not edited for this client). A discarded log doesn't count as started.
 */
export function isLiveWorkout(
  w: { programLive: boolean; customised: boolean; started: boolean; date: IsoDate },
  today: IsoDate,
): boolean {
  return w.programLive && !w.customised && !w.started && w.date > today;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ago(then: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${plural(Math.floor(hours / 24), 'day', 'days')} ago`;
}

/** The status line on the program page, e.g. "Live Sync on · 3 clients · last synced 2 min ago · 1 customised workout skipped". */
export function liveSyncStatus(
  s: { on: boolean; clients: number; syncedAt: string | null; skipped: number },
  now: Date,
): string {
  if (!s.on) return 'Live Sync off';
  const parts = ['Live Sync on', plural(s.clients, 'client', 'clients')];
  parts.push(s.syncedAt ? `last synced ${ago(new Date(s.syncedAt), now)}` : 'not synced yet');
  if (s.skipped > 0) parts.push(`${plural(s.skipped, 'customised workout', 'customised workouts')} skipped`);
  return parts.join(' · ');
}
