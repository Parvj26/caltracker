import { addDays, diffDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import type { LogStatus } from '../logs/schema';
import { logDurationS } from '../logs/summary';
import { compareByLastName } from '../names';

export const ENDING_WITHIN_DAYS = 7;
export const LAST_WORKOUT_LOOKBACK_DAYS = 30;

export type HomeLog = {
  id: string;
  status: LogStatus;
  startedAt: string;
  finishedAt: string | null;
  lastActivityAt: string;
  /** Who is logging it (workout_logs.logged_by); left out when the caller doesn't track it. */
  loggedBy?: string | null;
};
export type HomeWorkout = { id: string; clientId: string; name: string; scheduledOn: IsoDate; logs: HomeLog[] };
export type HomeClient = {
  id: string;
  firstName: string;
  lastName: string;
  joinedOn: IsoDate;
  lastFinishedOn: IsoDate | null;
};
export type HomeAssignment = {
  id: string;
  clientId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  cancelledOn: IsoDate | null;
};
export type WorkoutStatus =
  | { kind: 'not_started' }
  | { kind: 'training'; logId: string; loggedBy?: string | null | undefined }
  | { kind: 'done'; logId: string; durationS: number };
export type TodayRow = { workout: HomeWorkout; client: HomeClient; status: WorkoutStatus };

/** Done beats training beats not started. Discarded logs never count. */
export function workoutStatus(w: HomeWorkout): WorkoutStatus {
  let newest: HomeLog | null = null;
  for (const l of w.logs) {
    if (l.status !== 'completed') continue;
    if (!newest || Date.parse(l.finishedAt ?? l.lastActivityAt) > Date.parse(newest.finishedAt ?? newest.lastActivityAt)) {
      newest = l;
    }
  }
  if (newest) return { kind: 'done', logId: newest.id, durationS: logDurationS(newest) };
  const running = w.logs.find((l) => l.status === 'in_progress');
  if (running) return { kind: 'training', logId: running.id, loggedBy: running.loggedBy };
  return { kind: 'not_started' };
}

export function todayRows(workouts: HomeWorkout[], clients: HomeClient[], today: IsoDate): TodayRow[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const rows: TodayRow[] = [];
  for (const workout of workouts) {
    if (workout.scheduledOn !== today) continue;
    const client = byId.get(workout.clientId);
    if (!client) continue;
    rows.push({ workout, client, status: workoutStatus(workout) });
  }
  return rows.sort(
    (a, b) => compareByLastName(a.client, b.client) || a.workout.name.localeCompare(b.workout.name, 'en'),
  );
}

export function weekProgress(workouts: HomeWorkout[], today: IsoDate): { done: number; planned: number } {
  const start = startOfWeek(today);
  const end = addDays(start, 6);
  let done = 0;
  let planned = 0;
  for (const w of workouts) {
    if (w.scheduledOn < start || w.scheduledOn > end) continue;
    planned += 1;
    if (workoutStatus(w).kind === 'done') done += 1;
  }
  return { done, planned };
}

export function endingPrograms(
  assignments: HomeAssignment[],
  today: IsoDate,
): Array<{ clientId: string; assignmentId: string; daysLeft: number }> {
  const live = assignments.filter((a) => a.cancelledOn === null);
  const last = addDays(today, ENDING_WITHIN_DAYS);
  return live
    .filter((a) => a.endDate >= today && a.endDate <= last)
    .filter((a) => !live.some((o) => o.id !== a.id && o.clientId === a.clientId && o.startDate > a.endDate))
    .map((a) => ({ clientId: a.clientId, assignmentId: a.id, daysLeft: diffDays(today, a.endDate) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
