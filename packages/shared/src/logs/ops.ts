import type { ExercisePick } from '../workouts/doc-ops';
import { TARGET_FIELDS } from '../workouts/targets';
import type { LogBlockDoc, LogExerciseDoc, LogSetDoc, LogSetTarget, WorkoutLogDoc } from './schema';
import { canReopen } from './summary';

const DEFAULT_SETS = 3;
const MAX_SETS = 30;
const MAX_BLOCKS = 30;

export type ActualPatch = Partial<
  Pick<LogSetDoc, 'actualReps' | 'actualWeightKg' | 'actualDurationS' | 'actualDistanceM'>
>;

const emptyTarget = (restSeconds: number | null): LogSetTarget => ({
  repsMin: null,
  repsMax: null,
  weightKg: null,
  durationS: null,
  distanceM: null,
  toFailure: false,
  restSeconds,
});

const touch = (log: WorkoutLogDoc, blocks: LogBlockDoc[], nowIso: string): WorkoutLogDoc => ({
  ...log,
  blocks,
  lastActivityAt: nowIso,
  revision: log.revision + 1,
});

/** Maps one exercise by id. Unknown id, or a mapper that returns the same object (a refused edit), leaves the doc untouched. */
function mapExercise(
  log: WorkoutLogDoc,
  logExerciseId: string,
  fn: (ex: LogExerciseDoc) => LogExerciseDoc,
  nowIso: string,
): WorkoutLogDoc {
  let changed = false;
  const blocks = log.blocks.map((b) => ({
    ...b,
    exercises: b.exercises.map((e) => {
      if (e.id !== logExerciseId) return e;
      const next = fn(e);
      if (next !== e) changed = true;
      return next;
    }),
  }));
  return changed ? touch(log, blocks, nowIso) : log;
}

function mapSet(
  log: WorkoutLogDoc,
  setId: string,
  fn: (s: LogSetDoc) => LogSetDoc,
): { log: WorkoutLogDoc; found: boolean } {
  let found = false;
  const blocks = log.blocks.map((b) => ({
    ...b,
    exercises: b.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => {
        if (s.id !== setId) return s;
        found = true;
        return fn(s);
      }),
    })),
  }));
  return { log: { ...log, blocks }, found };
}

export function completeSet(log: WorkoutLogDoc, setId: string, nowIso: string): WorkoutLogDoc {
  const r = mapSet(log, setId, (s) => ({ ...s, completedAt: nowIso }));
  return r.found ? { ...r.log, lastActivityAt: nowIso, revision: log.revision + 1 } : log;
}

export function uncompleteSet(log: WorkoutLogDoc, setId: string, nowIso: string): WorkoutLogDoc {
  const r = mapSet(log, setId, (s) => ({ ...s, completedAt: null }));
  return r.found ? { ...r.log, lastActivityAt: nowIso, revision: log.revision + 1 } : log;
}

/** Typing into a field is not "activity" for the idle timers, so only the revision moves. */
export function updateActual(log: WorkoutLogDoc, setId: string, patch: ActualPatch): WorkoutLogDoc {
  const r = mapSet(log, setId, (s) => ({ ...s, ...patch }));
  return r.found ? { ...r.log, revision: log.revision + 1 } : log;
}

export function addLogSet(
  log: WorkoutLogDoc,
  logExerciseId: string,
  makeId: () => string,
  nowIso: string,
): WorkoutLogDoc {
  return mapExercise(
    log,
    logExerciseId,
    (ex) => {
      if (ex.sets.length >= MAX_SETS) return ex;
      const last = [...ex.sets].reverse().find((s) => s.setType !== 'drop');
      const fresh: LogSetDoc = {
        id: makeId(),
        setType: 'normal',
        target: last ? { ...last.target } : emptyTarget(null),
        actualReps: last?.actualReps ?? null,
        actualWeightKg: last?.actualWeightKg ?? null,
        actualDurationS: last?.actualDurationS ?? null,
        actualDistanceM: last?.actualDistanceM ?? null,
        completedAt: null,
      };
      return { ...ex, sets: [...ex.sets, fresh] };
    },
    nowIso,
  );
}

export function addLogDrop(
  log: WorkoutLogDoc,
  logExerciseId: string,
  parentSetId: string,
  makeId: () => string,
  nowIso: string,
): WorkoutLogDoc {
  return mapExercise(
    log,
    logExerciseId,
    (ex) => {
      const parentIdx = ex.sets.findIndex((s) => s.id === parentSetId);
      if (parentIdx < 0 || ex.sets[parentIdx]!.setType === 'drop' || ex.sets.length >= MAX_SETS) return ex;
      let at = parentIdx + 1;
      while (at < ex.sets.length && ex.sets[at]!.setType === 'drop') at += 1;
      const drop: LogSetDoc = {
        id: makeId(),
        setType: 'drop',
        target: emptyTarget(0),
        actualReps: null,
        actualWeightKg: null,
        actualDurationS: null,
        actualDistanceM: null,
        completedAt: null,
      };
      return { ...ex, sets: [...ex.sets.slice(0, at), drop, ...ex.sets.slice(at)] };
    },
    nowIso,
  );
}

export function removeLogSet(
  log: WorkoutLogDoc,
  logExerciseId: string,
  setId: string,
  nowIso: string,
): WorkoutLogDoc {
  return mapExercise(
    log,
    logExerciseId,
    (ex) => {
      const idx = ex.sets.findIndex((s) => s.id === setId);
      if (idx < 0) return ex;
      const target = ex.sets[idx]!;
      if (target.setType !== 'drop' && ex.sets.filter((s) => s.setType !== 'drop').length <= 1) return ex;
      let end = idx + 1;
      if (target.setType !== 'drop') while (end < ex.sets.length && ex.sets[end]!.setType === 'drop') end += 1;
      return { ...ex, sets: [...ex.sets.slice(0, idx), ...ex.sets.slice(end)] };
    },
    nowIso,
  );
}

export function swapLogExercise(
  log: WorkoutLogDoc,
  logExerciseId: string,
  ex: ExercisePick,
  nowIso: string,
): WorkoutLogDoc {
  const keep = TARGET_FIELDS[ex.trackingType];
  const reps = keep.includes('reps');
  const weight = keep.includes('weight');
  const duration = keep.includes('duration');
  const distance = keep.includes('distance');
  return mapExercise(
    log,
    logExerciseId,
    (old) => ({
      ...old,
      swappedFromExerciseId: old.swappedFromExerciseId ?? old.exerciseId,
      exerciseId: ex.id,
      exerciseName: ex.name,
      trackingType: ex.trackingType,
      sets: old.sets.map((s) => ({
        ...s,
        target: {
          ...s.target,
          repsMin: reps ? s.target.repsMin : null,
          repsMax: reps ? s.target.repsMax : null,
          weightKg: weight ? s.target.weightKg : null,
          durationS: duration ? s.target.durationS : null,
          distanceM: distance ? s.target.distanceM : null,
        },
        actualReps: reps ? s.actualReps : null,
        actualWeightKg: weight ? s.actualWeightKg : null,
        actualDurationS: duration ? s.actualDurationS : null,
        actualDistanceM: distance ? s.actualDistanceM : null,
      })),
    }),
    nowIso,
  );
}

export function addLogExercise(
  log: WorkoutLogDoc,
  ex: ExercisePick,
  makeId: () => string,
  nowIso: string,
): WorkoutLogDoc {
  if (log.blocks.length >= MAX_BLOCKS) return log;
  const block: LogBlockDoc = {
    id: makeId(),
    kind: 'straight',
    exercises: [
      {
        id: makeId(),
        exerciseId: ex.id,
        exerciseName: ex.name,
        trackingType: ex.trackingType,
        plannedWorkoutExerciseId: null,
        swappedFromExerciseId: null,
        note: null,
        sets: Array.from({ length: DEFAULT_SETS }, () => ({
          id: makeId(),
          setType: 'normal' as const,
          target: emptyTarget(null),
          actualReps: null,
          actualWeightKg: null,
          actualDurationS: null,
          actualDistanceM: null,
          completedAt: null,
        })),
      },
    ],
  };
  return touch(log, [...log.blocks, block], nowIso);
}

export function removeLogExercise(log: WorkoutLogDoc, logExerciseId: string, nowIso: string): WorkoutLogDoc {
  if (!log.blocks.some((b) => b.exercises.some((e) => e.id === logExerciseId))) return log;
  const blocks: LogBlockDoc[] = [];
  for (const b of log.blocks) {
    const exercises = b.exercises.filter((e) => e.id !== logExerciseId);
    if (exercises.length === 0) continue;
    blocks.push(
      exercises.length === b.exercises.length
        ? b
        : { ...b, kind: exercises.length === 1 ? 'straight' : b.kind, exercises },
    );
  }
  return touch(log, blocks, nowIso);
}

export function setExerciseNote(
  log: WorkoutLogDoc,
  logExerciseId: string,
  note: string | null,
  nowIso: string,
): WorkoutLogDoc {
  return mapExercise(log, logExerciseId, (ex) => ({ ...ex, note }), nowIso);
}

const hasCompletedSet = (log: WorkoutLogDoc) =>
  log.blocks.some((b) => b.exercises.some((e) => e.sets.some((s) => s.completedAt !== null)));

/**
 * Finishes an in-progress log by hand: completed, finishedAt = now. Refused (same object back) when it is not
 * in progress or no set is ticked, because a completed log needs at least one completed set.
 */
export function finishLog(log: WorkoutLogDoc, nowIso: string): WorkoutLogDoc {
  if (log.status !== 'in_progress' || !hasCompletedSet(log)) return log;
  return {
    ...log,
    status: 'completed',
    finishedAt: nowIso,
    lastActivityAt: nowIso,
    autoFinished: false,
    revision: log.revision + 1,
  };
}

/** Throws an in-progress log away. Refused (same object back) once it is finished or discarded. */
export function discardLog(log: WorkoutLogDoc, nowIso: string): WorkoutLogDoc {
  if (log.status !== 'in_progress') return log;
  return { ...log, status: 'discarded', lastActivityAt: nowIso, revision: log.revision + 1 };
}

/**
 * "Add missed sets": puts a log finished automatically back in progress, within 24 h of its finish (canReopen).
 * The finish time and the auto-finished flag are cleared and the activity time is now, so the idle timers start
 * again; the ticked sets are kept. Refused (same object back) for anything canReopen refuses.
 * The server keeps its stored auto_finished only while the log is reopened. A manual finish afterwards
 * (finishLog, autoFinished false) ends with auto_finished = false on the server, so the log is then locked.
 */
export function reopenLog(log: WorkoutLogDoc, nowIso: string): WorkoutLogDoc {
  if (!canReopen(log, Date.parse(nowIso))) return log;
  return {
    ...log,
    status: 'in_progress',
    finishedAt: null,
    autoFinished: false,
    lastActivityAt: nowIso,
    revision: log.revision + 1,
  };
}

/**
 * Ticks the set when it is open and unticks it when it is ticked, deciding from this doc (the stored one), not
 * from what a screen last showed. `completed` is the new state, or null when the set is not in the log.
 */
export function toggleSet(
  log: WorkoutLogDoc,
  setId: string,
  nowIso: string,
): { log: WorkoutLogDoc; completed: boolean | null } {
  for (const b of log.blocks) {
    for (const e of b.exercises) {
      const s = e.sets.find((x) => x.id === setId);
      if (!s) continue;
      return s.completedAt === null
        ? { log: completeSet(log, setId, nowIso), completed: true }
        : { log: uncompleteSet(log, setId, nowIso), completed: false };
    }
  }
  return { log, completed: null };
}
