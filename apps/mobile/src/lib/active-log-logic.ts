// Pure decisions behind the active workout (use-active-log.tsx) and Today. No React, storage or network here,
// so they run in unit tests. Workout rules themselves (auto-finish, duration) come from @caltracker/shared.
import {
  autoFinish,
  emptyLog,
  logDurationS,
  parseClock,
  shouldAutoFinish,
  startLogFromWorkout,
  type LogStatus,
  type WorkoutDoc,
  type WorkoutLogDoc,
} from '@caltracker/shared';

/**
 * The log to open when the client taps Start: the one already in progress (there is only ever one, whichever
 * workout it belongs to), or a new one from the plan. A new log starts at revision 1, because the sync sends
 * only revisions above the last uploaded one (0 for a log the server has never seen).
 */
export function startOrResume(
  existing: WorkoutLogDoc | null,
  /** The planned workout, or the name of an unplanned one. */
  from: WorkoutDoc | string,
  makeId: () => string,
  nowIso: string,
): WorkoutLogDoc {
  if (existing?.status === 'in_progress') return existing;
  const fresh = typeof from === 'string' ? emptyLog(from, makeId, nowIso) : startLogFromWorkout(from, makeId, nowIso);
  return { ...fresh, revision: 1 };
}

/** "10:40 AM" in the phone's own time zone. */
export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * On open and on return to the app: a workout left idle for 3 hours is finished (or discarded when nothing was
 * ticked) with the shared rules. Returns the new log and the one-time note to show, or null when nothing changes.
 */
export function foregroundCheck(log: WorkoutLogDoc, nowMs: number): { log: WorkoutLogDoc; banner: string | null } | null {
  if (!shouldAutoFinish(log, nowMs)) return null;
  const next = autoFinish(log);
  const banner =
    next.status === 'completed' && next.finishedAt !== null
      ? `We finished ${next.name} for you at ${formatTimeOfDay(next.finishedAt)}.`
      : null;
  return { log: next, banner };
}

export type ActualField = 'reps' | 'weight' | 'duration' | 'distance';

/**
 * What the client typed into an actual box, as a number in the box's own unit (lb or kg, km or mi, seconds).
 * Blank is null (no value); anything that can't be saved is undefined, and the box keeps the last saved value.
 */
export function parseActualInput(text: string, field: ActualField): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (field === 'duration') {
    const s = parseClock(t);
    return s === null || Number.isNaN(s) || s > 86400 ? undefined : s;
  }
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return undefined;
  const v = Number(t);
  if (field === 'reps') return Number.isInteger(v) && v <= 1000 ? v : undefined;
  return v <= (field === 'weight' ? 2000 : 1000) ? v : undefined;
}

export type WorkoutStatus = { kind: 'done'; logId: string; durationS: number } | { kind: 'in_progress'; logId: string };

type LogTimes = {
  id: string;
  workoutId: string | null;
  status: LogStatus;
  startedAt: string;
  finishedAt: string | null;
  lastActivityAt: string;
};

function statusOf(l: LogTimes): WorkoutStatus | null {
  if (l.status === 'completed') return { kind: 'done', logId: l.id, durationS: logDurationS(l) };
  if (l.status === 'in_progress') return { kind: 'in_progress', logId: l.id };
  return null;
}

/** The workout just finished on this phone, remembered until Today's list from the server includes it. */
export type FinishedNote = { logId: string; workoutId: string; durationS: number };

/** A finished planned log as a note to remember; null for anything else (in progress, discarded, unplanned). */
export function finishedFrom(log: WorkoutLogDoc | null): FinishedNote | null {
  if (!log || log.status !== 'completed' || !log.workoutId) return null;
  return { logId: log.id, workoutId: log.workoutId, durationS: logDurationS(log) };
}

/** True once a server list has the remembered log, so it can be forgotten. */
export function finishedIsLoaded(finished: FinishedNote | null, logs: readonly { id: string }[]): boolean {
  return finished !== null && logs.some((l) => l.id === finished.logId);
}

/**
 * Per planned workout id: done (with its duration) or in progress. Server logs are matched by the planned
 * workout they belong to (fetched by its scheduled date, never by the finish time). The workout just finished
 * here keeps its Done ✓ after the phone's copy is cleared on upload and before Today's list catches up; the
 * phone's own copy wins over both, since it may be newer than what has uploaded.
 */
export function workoutStatuses(
  server: readonly LogTimes[],
  local: WorkoutLogDoc | null,
  finished: FinishedNote | null = null,
): Record<string, WorkoutStatus> {
  const out: Record<string, WorkoutStatus> = {};
  for (const l of server) {
    const s = l.workoutId ? statusOf(l) : null;
    if (s && l.workoutId) out[l.workoutId] = s;
  }
  if (finished) out[finished.workoutId] = { kind: 'done', logId: finished.logId, durationS: finished.durationS };
  if (local?.workoutId) {
    const s = statusOf(local);
    if (s) out[local.workoutId] = s;
    else delete out[local.workoutId];
  }
  return out;
}

/** The promise's value, or null when it fails or takes longer than `ms` (poor signal must never hang a tap). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}
