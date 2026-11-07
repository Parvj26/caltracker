// Watching the coach log (single active logger, phone side): while the coach logs the client's open workout from the
// website, the phone shows the normal logging pages read only, and follows the coach's saves live. Pure rules here;
// coach-logging.ts decides when to pull the coach's copy, use-active-log.tsx stores it, and the logging screen draws it.
import type { LogStatus, WorkoutLogDoc } from '@caltracker/shared';
import type { LoggerState } from './active-log-logic';
import type { StoredLog } from './log-store';

/**
 * What the logging screen shows: `watch` the read-only pages (the coach logs the workout open on this phone),
 * `banner` the full "Your coach is logging / logged this session" card (no open copy here, or it is finished), or
 * `own` the client's own logging.
 */
export function coachWatchView(byCoach: boolean, log: { id: string; status: LogStatus } | null, id: string | undefined): 'watch' | 'banner' | 'own' {
  if (!byCoach) return 'own';
  return log !== null && log.id === id && log.status === 'in_progress' ? 'watch' : 'banner';
}

/** Which controls the logging pages offer. Read only (the coach logs it): moving around and reading only. */
export type LogControls = {
  /** Number boxes take typing. */
  type: boolean;
  tick: boolean;
  markAll: boolean;
  done: boolean;
  addSet: boolean;
  deleteSet: boolean;
  /** "Machine taken? Switch to …" and "Switch" on the coach's substitute. */
  substituteSwitch: boolean;
  /** ⇄: swap the exercise. */
  swap: boolean;
  /** •••: note, drop set, delete, remove. */
  more: boolean;
  /** ✉: a note for the coach. */
  message: boolean;
  addExercise: boolean;
  finish: boolean;
  discard: boolean;
  /** ↺: last time's numbers. */
  history: boolean;
  /** Photos, steps and the demo video. */
  info: boolean;
  /** Swipe, ‹ ›, dots, sections. */
  navigate: boolean;
};

export function logControls(readOnly: boolean): LogControls {
  const edit = !readOnly;
  return {
    type: edit,
    tick: edit,
    markAll: edit,
    done: edit,
    addSet: edit,
    deleteSet: edit,
    substituteSwitch: edit,
    swap: edit,
    more: edit,
    message: edit,
    addExercise: edit,
    finish: edit,
    discard: edit,
    history: true,
    info: true,
    navigate: true,
  };
}

/** The set ticked most recently (latest completedAt; on a tie the later one in the workout), or null. */
export function latestTickedSetId(log: WorkoutLogDoc): string | null {
  let best: { id: string; at: number } | null = null;
  for (const b of log.blocks) {
    for (const e of b.exercises) {
      for (const s of e.sets) {
        if (s.completedAt === null) continue;
        const at = Date.parse(s.completedAt);
        if (Number.isNaN(at)) continue;
        if (best === null || at >= best.at) best = { id: s.id, at };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Whether a change to the log's row (the coach saved: ticked a set, typed a number) should pull the coach's copy:
 * only while the server and the phone agree the coach holds the open workout. Take over, hand back, reclaim and
 * finish stay with needsServerCopy / refreshFromServer. Pure.
 */
export function shouldPullCoachCopy(server: LoggerState | null, local: { status: LogStatus; heldByOther: boolean } | null): boolean {
  if (!server || !local) return false;
  return server.status === 'in_progress' && server.heldByOther && local.status === 'in_progress' && local.heldByOther;
}

/**
 * The stored log after pulling the coach's copy of the held log: the coach's copy, marked synced so the phone never
 * sends it back, when it is newer and still in progress; otherwise the stored log unchanged (an older answer landing
 * late, a log the coach no longer holds, another log). Pure.
 */
export function adoptCoachCopy(stored: StoredLog | null, server: WorkoutLogDoc, heldId: string | null): StoredLog | null {
  if (!stored || heldId === null || stored.log.id !== heldId || server.id !== heldId) return stored;
  if (server.status !== 'in_progress' || server.revision <= stored.log.revision) return stored;
  return { log: server, lastSyncedRevision: server.revision };
}

/**
 * The client was watching the coach log this workout and the coach just finished it: go straight to the sticker
 * reveal (then the summary), as after the client's own Finish. Pure.
 */
export function revealAfterCoachFinish(watched: boolean, coach: { byCoach: boolean; status: LogStatus | null }): boolean {
  return watched && coach.byCoach && coach.status === 'completed';
}
