// Coach session logging (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md). Pure helpers shared by
// the coach website and the phone, so both decide "who is logging this" and "Mark all" the same way.
import type { ResultSet } from './format';
import { liveExercises } from './flow';
import { completeSetWith } from './ops';
import { resolveSetValues } from './prefill';
import type { LogStatus, WorkoutLogDoc } from './schema';

/**
 * True when the log was logged by someone other than its client (their coach): the "Logged by coach" badge.
 * A log with no logger (the account was deleted, or an old row) counts as the client's own.
 */
export function isLoggedByCoach(row: { loggedBy: string | null; clientId: string }): boolean {
  return row.loggedBy !== null && row.loggedBy !== row.clientId;
}

export type SessionLog = { id: string; workoutId: string | null; status: LogStatus; loggedBy: string | null; name: string };

/** What the coach's logging page shows for one planned workout. */
export type CoachSessionState =
  | { kind: 'start' }
  | { kind: 'mine'; logId: string }
  | { kind: 'client_logging'; logId: string }
  | { kind: 'done'; logId: string }
  /** The client has a different workout in progress; only one can be in progress at a time. */
  | { kind: 'other_workout'; logId: string; name: string; byCoach: boolean };

/**
 * Single active logger, from the client's logs of this workout plus any log they have in progress. An in-progress log
 * of this workout wins (the coach's own: resume it; anyone else's: the client is logging it on the phone), then
 * a finished one (open it), then another workout in progress (it blocks a new start), else a new session.
 */
export function coachSessionState(input: {
  workoutId: string;
  coachId: string;
  clientId: string;
  logs: readonly SessionLog[];
}): CoachSessionState {
  const running = input.logs.find((l) => l.status === 'in_progress');
  if (running && running.workoutId === input.workoutId) {
    return running.loggedBy === input.coachId ? { kind: 'mine', logId: running.id } : { kind: 'client_logging', logId: running.id };
  }
  const done = input.logs.find((l) => l.workoutId === input.workoutId && l.status === 'completed');
  if (done) return { kind: 'done', logId: done.id };
  if (running) {
    return { kind: 'other_workout', logId: running.id, name: running.name, byCoach: running.loggedBy === input.coachId };
  }
  return { kind: 'start' };
}

/**
 * "Mark all": ticks every open set of one block (a straight exercise, a superset, or a pick-one group's picked
 * option), each with its pre-filled numbers (resolveSetValues, so typed values, the coach's targets and last time
 * are used exactly as for a single tick). Ticked sets keep their numbers and time. Same doc back when nothing is
 * open, the block is unknown, or a pick-one group has no pick yet.
 */
export function completeAllSets(
  log: WorkoutLogDoc,
  blockId: string,
  lastTimeFor: (exerciseId: string) => readonly ResultSet[],
  nowIso: string,
): WorkoutLogDoc {
  const block = log.blocks.find((b) => b.id === blockId);
  if (!block) return log;
  let out = log;
  for (const { exercise } of liveExercises(block)) {
    for (const set of exercise.sets) {
      if (set.completedAt !== null) continue;
      // Resolve against the doc as it is now, so each set carries forward the ones ticked just before it.
      const current = out.blocks.find((b) => b.id === blockId)!.exercises.find((e) => e.id === exercise.id)!;
      out = completeSetWith(out, set.id, resolveSetValues(current, set.id, lastTimeFor(exercise.exerciseId)), nowIso);
    }
  }
  return out;
}
