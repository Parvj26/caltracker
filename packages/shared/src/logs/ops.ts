import type { ExercisePick } from '../workouts/doc-ops';
import { TARGET_FIELDS } from '../workouts/targets';
import type { LogBlockDoc, LogExerciseDoc, LogSetDoc, LogSetTarget, WorkoutLogDoc } from './schema';
import type { SetValues } from './prefill';
import { stepSetValue, type StepField } from './steppers';
import { isChoiceLocked, isUnpickedSet } from './flow';
import { canReopen } from './summary';
import type { Units } from '../units/units';

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
  if (isUnpickedSet(log, setId)) return log;
  const r = mapSet(log, setId, (s) => ({ ...s, completedAt: nowIso }));
  return r.found ? { ...r.log, lastActivityAt: nowIso, revision: log.revision + 1 } : log;
}

/** Fills only the actuals that are null from `values`, then completes the set. Same object back if the set is unknown or already completed. Bumps revision and lastActivityAt like completeSet. */
export function completeSetWith(
  log: WorkoutLogDoc,
  setId: string,
  values: SetValues,
  nowIso: string,
): WorkoutLogDoc {
  if (isUnpickedSet(log, setId)) return log;
  let skip = false;
  const r = mapSet(log, setId, (s) => {
    if (s.completedAt !== null) {
      skip = true;
      return s;
    }
    return {
      ...s,
      actualReps: s.actualReps ?? values.reps,
      actualWeightKg: s.actualWeightKg ?? values.weightKg,
      actualDurationS: s.actualDurationS ?? values.durationS,
      actualDistanceM: s.actualDistanceM ?? values.distanceM,
      completedAt: nowIso,
    };
  });
  return r.found && !skip ? { ...r.log, lastActivityAt: nowIso, revision: log.revision + 1 } : log;
}

export function uncompleteSet(log: WorkoutLogDoc, setId: string, nowIso: string): WorkoutLogDoc {
  const r = mapSet(log, setId, (s) => ({ ...s, completedAt: null }));
  return r.found ? { ...r.log, lastActivityAt: nowIso, revision: log.revision + 1 } : log;
}

/** Typing into a field is not "activity" for the idle timers, so only the revision moves. */
export function updateActual(log: WorkoutLogDoc, setId: string, patch: ActualPatch): WorkoutLogDoc {
  if (isUnpickedSet(log, setId)) return log;
  const r = mapSet(log, setId, (s) => ({ ...s, ...patch }));
  return r.found ? { ...r.log, revision: log.revision + 1 } : log;
}

const ACTUAL_KEY: Record<StepField, keyof ActualPatch> = {
  weight: 'actualWeightKg',
  reps: 'actualReps',
  duration: 'actualDurationS',
  distance: 'actualDistanceM',
};

/**
 * One − or + press on a set's number, worked out from the value stored at the time the edit runs (or `shown`, the
 * pre-filled number on screen, when nothing is stored yet). Run inside the queued edit, so fast presses all count.
 * Returns the same doc when the press changes nothing or the set is gone.
 */
export function stepActual(
  log: WorkoutLogDoc,
  setId: string,
  field: StepField,
  direction: 1 | -1,
  units: Units,
  shown: number | null,
): WorkoutLogDoc {
  if (isUnpickedSet(log, setId)) return log;
  const key = ACTUAL_KEY[field];
  const set = log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets)).find((s) => s.id === setId);
  if (!set) return log;
  const from = set[key] ?? shown;
  const next = stepSetValue(field, from, direction, units);
  if (next === set[key]) return log;
  return updateActual(log, setId, { [key]: next });
}

/** The set a drop hangs from: the set itself, or for a drop the nearest warm-up / working set above it. */
export function dropParentId(ex: LogExerciseDoc, setIndex: number): string | null {
  let i = setIndex;
  while (i > 0 && ex.sets[i]?.setType === 'drop') i -= 1;
  return ex.sets[i]?.id ?? null;
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
        actualReps: null,
        actualWeightKg: null,
        actualDurationS: null,
        actualDistanceM: null,
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
    sectionId: null,
    pickedExerciseId: null,
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
    // Taking one option out of a pick-one group takes the whole group out.
    if (b.kind === 'choice' && b.exercises.some((e) => e.id === logExerciseId)) continue;
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

/**
 * Sets (or with null, clears) the pick of a pick-one group; `logExerciseId` is the option's log exercise id.
 * Refused (same object back) for a block that is not a pick-one group, an id that is not one of its options, or
 * once the picked option has a done set and the id would change the pick. Values typed into an option that is
 * later left behind stay in the log, but only the picked option's sets ever count (flow, summary, volume).
 */
export function pickChoice(log: WorkoutLogDoc, blockId: string, logExerciseId: string | null, nowIso: string): WorkoutLogDoc {
  const block = log.blocks.find((b) => b.id === blockId);
  if (!block || block.kind !== 'choice') return log;
  if (logExerciseId !== null && !block.exercises.some((e) => e.id === logExerciseId)) return log;
  if (block.pickedExerciseId === logExerciseId) return log;
  if (isChoiceLocked(block)) return log;
  return touch(
    log,
    log.blocks.map((b) => (b.id === blockId ? { ...b, pickedExerciseId: logExerciseId } : b)),
    nowIso,
  );
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
      if (s.completedAt === null && isUnpickedSet(log, setId)) return { log, completed: null };
      return s.completedAt === null
        ? { log: completeSet(log, setId, nowIso), completed: true }
        : { log: uncompleteSet(log, setId, nowIso), completed: false };
    }
  }
  return { log, completed: null };
}
