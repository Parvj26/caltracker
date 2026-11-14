import { diffDays, formatPlainDay, workoutStatus } from '@caltracker/shared';
import type { HomeWorkout, IsoDate, TodayRow, WorkoutStatus } from '@caltracker/shared';
import { liveAction, todayAction, type TodayAction } from './home-actions';
import { liveLogByClient, minutesSince, trainingNow, type LiveLog } from './home-live';

/**
 * The client Overview's Today card, in one of three states:
 * - live: the client is training right now (Home's "Training now" rule), with Watch live, or Continue when it is the
 *   coach's own session;
 * - planned: a workout on today's calendar, with Home's Today-row button (Log session, Continue, Watch, View);
 * - nothing: no workout today, with the last one done and the next one planned.
 * The buttons come from the same functions Home uses (home-actions.ts), so the two pages can't disagree.
 */
export type ClientToday =
  | { kind: 'live'; log: LiveLog; minutes: number; action: TodayAction }
  | { kind: 'planned'; workout: HomeWorkout; status: WorkoutStatus; action: TodayAction; moreToday: number }
  | { kind: 'nothing'; last: { name: string; on: IsoDate } | null; next: { name: string; on: IsoDate } | null };

export type ClientTodayInput = {
  clientId: string;
  coachId: string;
  /** The coach's own today, from the browser. */
  today: IsoDate;
  nowMs: number;
  /** The client's planned workouts around today, with their logs (and who logs them). */
  workouts: readonly HomeWorkout[];
  /** Workouts in progress (any client's: the others are left out). */
  live: readonly LiveLog[];
};

export function clientToday({ clientId, coachId, today, nowMs, workouts, live }: ClientTodayInput): ClientToday {
  const mine = live.filter((l) => l.clientId === clientId);
  const [now] = trainingNow(mine, new Set([clientId]), nowMs);
  if (now) return { kind: 'live', log: now, minutes: minutesSince(now.startedAt, nowMs), action: liveAction(clientId, now, coachId) };

  const todays = workouts.filter((w) => w.clientId === clientId && w.scheduledOn === today).map((w) => ({ w, status: workoutStatus(w) }));
  const pick = todays.find((t) => t.status.kind !== 'done') ?? todays[0];
  if (pick) {
    // todayAction reads only the client's id from the row's client.
    const row: TodayRow = { workout: pick.w, status: pick.status, client: { id: clientId, firstName: '', lastName: '', joinedOn: today, lastFinishedOn: null } };
    return { kind: 'planned', workout: pick.w, status: pick.status, action: todayAction(row, coachId, liveLogByClient(mine).get(clientId)), moreToday: todays.length - 1 };
  }

  let last: HomeWorkout | null = null;
  let next: HomeWorkout | null = null;
  for (const w of workouts) {
    if (w.clientId !== clientId) continue;
    if (w.scheduledOn < today && workoutStatus(w).kind === 'done' && (!last || w.scheduledOn > last.scheduledOn)) last = w;
    if (w.scheduledOn > today && (!next || w.scheduledOn < next.scheduledOn)) next = w;
  }
  return {
    kind: 'nothing',
    last: last ? { name: last.name, on: last.scheduledOn } : null,
    next: next ? { name: next.name, on: next.scheduledOn } : null,
  };
}

/** "yesterday", "today", "tomorrow", else "Sun 15 Nov". */
export function relativeDay(day: IsoDate, today: IsoDate): string {
  const d = diffDays(today, day);
  if (d === -1) return 'yesterday';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return formatPlainDay(day);
}
