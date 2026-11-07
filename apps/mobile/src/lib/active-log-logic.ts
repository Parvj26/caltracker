// Pure decisions behind the active workout (use-active-log.tsx) and Today. No React, storage or network here,
// so they run in unit tests. Workout rules themselves (auto-finish, duration) come from @caltracker/shared.
import {
  autoFinish,
  completedSetCount,
  emptyLog,
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
  return { log: next, banner: autoFinishNote(next) };
}

/** "We finished Upper A for you at 10:40 AM." for a log finished automatically; null for anything else. */
function autoFinishNote(log: WorkoutLogDoc): string | null {
  return log.status === 'completed' && log.autoFinished && log.finishedAt !== null
    ? `We finished ${log.name} for you at ${formatTimeOfDay(log.finishedAt)}.`
    : null;
}

/** The one-time note after the coach removed the client and a workout could not be saved. */
export function goneNote(coach: string | null): string {
  return `You’re no longer with ${coach ?? 'your coach'}, so this workout wasn’t saved.`;
}

/** The one-time note after a workout could not be saved because one of its exercises was deleted. */
export function unavailableNote(name: string): string {
  return `${name} couldn’t be saved because one of its exercises is no longer available. Ask your coach to check it.`;
}

/** The one-time note after the server's copy of a workout replaced sets ticked on the phone. */
export function rejectedNote(name: string): string {
  return `Some sets from ${name} couldn’t be saved because the workout was already changed by your coach or on another device.`;
}

export type LogChange = {
  /** The log that has just stopped being in progress on this phone (for ended(): Done ✓ and the summary). */
  ended: WorkoutLogDoc | null;
  /** True when the workout in progress has gone: its reminder and rest alarm must not fire. */
  clearTimers: boolean;
  /** "We finished … for you at …" when it was finished automatically. */
  banner: string | null;
};

/**
 * What the screens must do when the stored log changes behind their back: the sync finished a forgotten workout
 * on a retry, adopted a server copy that is finished, or dropped the log (removed client). Pure. Changes made
 * by the screen itself (finish, discard, reopen) do their own housekeeping; running this too does no harm.
 */
export function logChange(prev: WorkoutLogDoc | null, next: WorkoutLogDoc | null): LogChange {
  if (prev?.status !== 'in_progress') return { ended: null, clearTimers: false, banner: null };
  if (next === null || next.id !== prev.id) return { ended: null, clearTimers: true, banner: null };
  if (next.status === 'in_progress') return { ended: null, clearTimers: false, banner: null };
  return { ended: next, clearTimers: true, banner: autoFinishNote(next) };
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
export function reopenFrom(
  stored: { log: WorkoutLogDoc; lastSyncedRevision: number } | null,
  logId: string,
  /** Finished logs still waiting to upload (the store's pending list). One of them can't be reopened yet. */
  pending: readonly { log: WorkoutLogDoc }[] = [],
): ReopenFrom {
  const waiting = pending.find((p) => p.log.id === logId);
  if (waiting && stored?.log.id !== logId) return { kind: 'blocked', name: waiting.log.name };
  if (stored === null) return { kind: 'fetch' };
  if (stored.log.id === logId) return { kind: 'local' };
  const busy = stored.log.status === 'in_progress' || stored.log.revision > stored.lastSyncedRevision;
  return busy ? { kind: 'blocked', name: stored.log.name } : { kind: 'fetch' };
}

/**
 * Per planned workout id: done (with its duration) or in progress. Server logs are matched by the planned
 * workout they belong to (fetched by its scheduled date, never by the finish time). The workout just finished
 * here keeps its Done ✓ after the phone's copy is cleared on upload and before Today's list catches up, and so
 * do finished logs still waiting to upload (pending), so they are never started twice; the phone's own copy
 * wins over all of them, since it may be newer than what has uploaded.
 */
export function workoutStatuses(
  server: readonly LogTimes[],
  local: WorkoutLogDoc | null,
  finished: FinishedNote | null = null,
  pending: readonly WorkoutLogDoc[] = [],
): Record<string, WorkoutStatus> {
  const out: Record<string, WorkoutStatus> = {};
  for (const l of server) {
    const s = l.workoutId ? statusOf(l) : null;
    if (s && l.workoutId) out[l.workoutId] = s;
  }
  for (const l of pending) {
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
