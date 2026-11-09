// The Workouts tab's copy saved on the phone: this week's plan, Coming up and the week's logs (so a finished or
// coach-logged workout still reads Done or in progress without signal, and Start is never offered twice). Pure, so
// it is unit tested; workouts-api.ts reads and writes it.
import { LOG_STATUSES, parseWorkoutDocLenient, type IsoDate } from '@caltracker/shared';
import type { LogForDay } from './log-api';
import type { PlannedWorkout } from './workouts-plan';

export type CachedPlan = { weekStart: IsoDate; week: PlannedWorkout[]; comingUp: PlannedWorkout[]; logs: LogForDay[] };

/** A saved LogForDay that can be trusted to drive Done ✓ and Resume. */
export function isLogForDay(v: unknown): v is LogForDay {
  const l = v as LogForDay;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof l.id === 'string' &&
    typeof l.workoutId === 'string' &&
    LOG_STATUSES.includes(l.status) &&
    typeof l.startedAt === 'string' &&
    typeof l.lastActivityAt === 'string'
  );
}

function validPlanned(v: unknown): PlannedWorkout | null {
  const p = v as Partial<PlannedWorkout> | null;
  if (typeof p !== 'object' || p === null || typeof p.scheduledOn !== 'string') return null;
  const doc = parseWorkoutDocLenient(p.doc);
  if (!doc.success) return null;
  const day = p.programDay;
  const programDay = day && typeof day.week === 'number' && typeof day.day === 'number' ? { week: day.week, day: day.day } : null;
  return { doc: doc.data, scheduledOn: p.scheduledOn, programName: typeof p.programName === 'string' ? p.programName : null, programDay };
}

/** The saved plan, or null when there is none or it is unreadable. Unreadable workouts and logs are dropped. */
export function parseCachedPlan(raw: string | null): CachedPlan | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as { weekStart?: unknown; week?: unknown; comingUp?: unknown; logs?: unknown };
    if (typeof v.weekStart !== 'string' || !Array.isArray(v.week) || !Array.isArray(v.comingUp)) return null;
    const list = (xs: unknown[]) => xs.map(validPlanned).filter((x): x is PlannedWorkout => x !== null);
    const logs = Array.isArray(v.logs) ? v.logs.filter(isLogForDay) : [];
    return { weekStart: v.weekStart, week: list(v.week), comingUp: list(v.comingUp), logs };
  } catch {
    return null;
  }
}

/** The week's logs: the server's when they could be read (`fresh`), else the saved ones of the same week. */
export function logsForWeek(fresh: LogForDay[] | null, cached: CachedPlan | null, weekStart: IsoDate): LogForDay[] {
  if (fresh !== null) return fresh;
  return cached?.weekStart === weekStart ? cached.logs : [];
}

/** The saved logs of one workout (for its Preview without signal). */
export function logsOfWorkout(cached: CachedPlan | null, workoutId: string): LogForDay[] {
  return cached?.logs.filter((l) => l.workoutId === workoutId) ?? [];
}
