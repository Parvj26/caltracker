// Pure decisions behind the active workout (use-active-log.tsx) and Today. No React, storage or network here,
// so they run in unit tests. Workout rules themselves (auto-finish, duration) come from @caltracker/shared.
import {
  autoFinish,
  completedSetCount,
  emptyLog,
  finishLog,
  formatLogDuration,
  formatLogVolume,
  logDurationS,
  logVolumeKg,
  parseClock,
  shouldAutoFinish,
  startLogFromWorkout,
  type LogStatus,
  type Units,
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Nov · 10:40 AM" in the phone's own time zone, for a coach comment. */
export function formatCommentTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} · ${formatTimeOfDay(iso)}`;
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
 * The remembered Done ✓ after the server's (or the stored) copy of a log replaces the phone's: forgotten when it
 * is the same log and no longer completed (discarded on another phone, reopened), kept otherwise.
 */
export function keepFinished(note: FinishedNote | null, doc: WorkoutLogDoc | null): FinishedNote | null {
  return note && doc && doc.id === note.logId && doc.status !== 'completed' ? null : note;
}

/**
 * The finished log remembered for its summary, after a newer copy of a log arrives: that newer copy while it is
 * still completed (a coach correction, say), forgotten when it no longer is, unchanged for any other log.
 */
export function keepEnded(ended: WorkoutLogDoc | null, doc: WorkoutLogDoc | null): WorkoutLogDoc | null {
  if (!ended || !doc || doc.id !== ended.id) return ended;
  return doc.status === 'completed' ? doc : null;
}

export type FinishPrompt = { kind: 'none-done' } | { kind: 'unticked'; count: number } | { kind: 'ready' };

const setCount = (log: WorkoutLogDoc) => log.blocks.reduce((n, b) => n + b.exercises.reduce((m, e) => m + e.sets.length, 0), 0);

/**
 * What tapping Finish does. The shared finishLog decides whether the log can be finished at all (it refuses one
 * with no ticked set: the client may only discard or keep going); otherwise unticked sets are asked about first.
 */
export function finishPrompt(log: WorkoutLogDoc, nowIso: string): FinishPrompt {
  if (finishLog(log, nowIso) === log) return { kind: 'none-done' };
  const count = setCount(log) - completedSetCount(log);
  return count > 0 ? { kind: 'unticked', count } : { kind: 'ready' };
}

/** "Finish with 3 sets not done? They won’t count." */
export function finishQuestion(count: number): string {
  return count === 1
    ? 'Finish with 1 set not done? It won’t count.'
    : `Finish with ${count} sets not done? They won’t count.`;
}

export type SummaryLines = { duration: string; volume: string | null; sets: string };

/** The summary's lines in the client's units. Volume is left out when nothing weighted was lifted. */
export function summaryLines(log: WorkoutLogDoc, units: Units): SummaryLines {
  const kg = logVolumeKg(log);
  const n = completedSetCount(log);
  return {
    duration: formatLogDuration(logDurationS(log)),
    volume: kg > 0 ? formatLogVolume(kg, units) : null,
    sets: `${n} ${n === 1 ? 'set' : 'sets'} completed`,
  };
}

export type ReopenFrom = { kind: 'local' } | { kind: 'fetch' } | { kind: 'blocked'; name: string };

/**
 * Where "Add missed sets" starts from, given the phone's stored log: that log itself, or the server's copy when
 * the phone has nothing that matters (the finished log has uploaded and been cleared). Another workout in
 * progress, or another finished one still waiting to upload, blocks it: the phone holds one log at a time.
 */
export function reopenFrom(stored: { log: WorkoutLogDoc; lastSyncedRevision: number } | null, logId: string): ReopenFrom {
  if (stored === null) return { kind: 'fetch' };
  if (stored.log.id === logId) return { kind: 'local' };
  const busy = stored.log.status === 'in_progress' || stored.log.revision > stored.lastSyncedRevision;
  return busy ? { kind: 'blocked', name: stored.log.name } : { kind: 'fetch' };
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
