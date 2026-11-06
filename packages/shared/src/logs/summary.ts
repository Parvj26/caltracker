import { liveExercises, needsPick } from './flow';
import type { LogExerciseDoc, LogSetDoc, WorkoutLogDoc } from './schema';

export const AUTO_FINISH_IDLE_MS = 3 * 60 * 60 * 1000;
export const REMINDER_DELAY_MS = 20 * 60 * 1000;
export const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

function allSets(log: WorkoutLogDoc): { set: LogSetDoc; weightReps: boolean }[] {
  return log.blocks.flatMap((b) =>
    b.exercises.flatMap((e) => e.sets.map((set) => ({ set, weightReps: e.trackingType === 'weight_reps' }))),
  );
}

/** Sum of weight x reps over completed sets of weight_reps exercises (warm-ups left out, drops counted), to 1 decimal. */
export function logVolumeKg(log: WorkoutLogDoc): number {
  let total = 0;
  for (const { set, weightReps } of allSets(log)) {
    if (weightReps && set.setType !== 'warmup' && set.completedAt !== null) total += (set.actualWeightKg ?? 0) * (set.actualReps ?? 0);
  }
  return Math.round(total * 10) / 10;
}

export function completedSetCount(log: WorkoutLogDoc): number {
  return allSets(log).filter(({ set }) => set.completedAt !== null).length;
}

/**
 * Counting rule: sets still to do: not-done sets of the exercises being done, plus for each pick-one group not yet picked from
 * its first option's normal sets (the best guess of what it will turn into).
 */
export function openSetCount(log: WorkoutLogDoc): number {
  let n = 0;
  for (const b of log.blocks) {
    if (needsPick(b)) {
      n += b.exercises[0]?.sets.filter((s) => s.setType === 'normal').length ?? 0;
    } else {
      for (const { exercise } of liveExercises(b)) n += exercise.sets.filter((s) => s.completedAt === null).length;
    }
  }
  return n;
}

/** Whole seconds: finishedAt - startedAt, or lastActivityAt - startedAt while still in progress. */
export function logDurationS(log: Pick<WorkoutLogDoc, 'startedAt' | 'finishedAt' | 'lastActivityAt'>): number {
  const end = log.finishedAt ?? log.lastActivityAt;
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(log.startedAt)) / 1000));
}

export function shouldAutoFinish(log: WorkoutLogDoc, nowMs: number): boolean {
  return log.status === 'in_progress' && nowMs - Date.parse(log.lastActivityAt) >= AUTO_FINISH_IDLE_MS;
}

/** The latest completedAt, or startedAt when no set is done. */
export function autoFinishTime(log: WorkoutLogDoc): string {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const { set } of allSets(log)) {
    if (set.completedAt === null) continue;
    const ms = Date.parse(set.completedAt);
    if (ms > bestMs) {
      bestMs = ms;
      best = set.completedAt;
    }
  }
  return best ?? log.startedAt;
}

/**
 * Finishes a forgotten workout (shouldAutoFinish) the way the server's hourly job does: completed at its last
 * ticked set, or discarded when nothing was ticked. Both are marked autoFinished, like the job's result, so the
 * server keeps accepting the phone's data for them.
 */
export function autoFinish(log: WorkoutLogDoc): WorkoutLogDoc {
  if (completedSetCount(log) === 0) {
    return { ...log, status: 'discarded', autoFinished: true, revision: log.revision + 1 };
  }
  return {
    ...log,
    status: 'completed',
    autoFinished: true,
    finishedAt: autoFinishTime(log),
    revision: log.revision + 1,
  };
}

export function canReopen(log: WorkoutLogDoc, nowMs: number): boolean {
  return (
    log.status === 'completed' &&
    log.autoFinished &&
    log.finishedAt !== null &&
    nowMs - Date.parse(log.finishedAt) < REOPEN_WINDOW_MS
  );
}

/**
 * True when the log followed a plan: any of its exercises came from a planned one. Decided from the log itself,
 * not workoutId, so a log keeps being "planned" after the coach deletes the plan (workoutId becomes null).
 */
export function isPlannedLog(log: Pick<WorkoutLogDoc, 'blocks'>): boolean {
  return log.blocks.some((b) => b.exercises.some((e) => e.plannedWorkoutExerciseId !== null));
}

/** "Added": an exercise the client added to a planned log. In an unplanned log nothing counts as added. */
export function isAddedExercise(log: Pick<WorkoutLogDoc, 'blocks'>, ex: Pick<LogExerciseDoc, 'plannedWorkoutExerciseId'>): boolean {
  return ex.plannedWorkoutExerciseId === null && isPlannedLog(log);
}
