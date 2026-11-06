import type { LogExerciseDoc, LogSetDoc, LogSubstituteOption, WorkoutLogDoc } from './schema';

/**
 * Coach-added substitutes in a log (spec: docs/superpowers/specs/2026-11-06-substitutes-design.md).
 *
 * A log exercise's own fields are always what the client is doing; `substituteOptions` (the planned exercise
 * first, then the coach's substitutes) are the other ways to do it, and `substituteId` names the option the
 * fields currently are (null: the planned exercise). So volume, PRs, strength, summaries and awards count the
 * exercise actually done without knowing about substitutes, and an option not chosen never has logged sets.
 */

/** The ways to do this exercise, for a picker: empty when the coach gave it no substitutes. */
export function substituteChoices(
  ex: LogExerciseDoc,
): Array<{ substituteId: string | null; exerciseId: string; exerciseName: string; planned: boolean; chosen: boolean }> {
  return ex.substituteOptions.map((o) => ({
    substituteId: o.substituteId,
    exerciseId: o.exerciseId,
    exerciseName: o.exerciseName,
    planned: o.substituteId === null,
    chosen: o.substituteId === ex.substituteId,
  }));
}

/** The options not being done right now ("or: Machine Assisted Pull Up"). */
export const otherSubstituteOptions = (ex: LogExerciseDoc): LogSubstituteOption[] =>
  ex.substituteOptions.filter((o) => o.substituteId !== ex.substituteId);

/** Once a set of this exercise is done, the client can no longer switch to another option. */
export const isSubstituteLocked = (ex: LogExerciseDoc): boolean => ex.sets.some((s) => s.completedAt !== null);

/**
 * The exercise as actually done: itself (the fields are always the live option). Kept as a named helper so
 * screens and counting code say what they mean, and so a later storage change has one place to go.
 */
export const liveExercise = (ex: LogExerciseDoc): LogExerciseDoc => ex;

/**
 * "Did the substitute: X (planned Y)": the planned exercise's id and name when the client chose a coach-added
 * substitute, otherwise null (the planned exercise, or no substitutes).
 */
export function substitutedFrom(ex: LogExerciseDoc): { exerciseId: string; exerciseName: string } | null {
  if (ex.substituteId === null) return null;
  const planned = ex.substituteOptions.find((o) => o.substituteId === null);
  return planned ? { exerciseId: planned.exerciseId, exerciseName: planned.exerciseName } : null;
}

/**
 * Switches the exercise to one of its options: a substitute's id, or null for the planned exercise. The
 * exercise takes that option's exercise, tracking type and planned sets (new set ids, nothing typed in), and
 * swappedFromExerciseId names the planned exercise while a substitute is chosen (so "Changes from the plan"
 * shows "Did X instead of Y"). Refused (same object back) for an unknown exercise or option, the option already
 * chosen, or once any set of the exercise is done (isSubstituteLocked).
 */
export function chooseSubstitute(
  log: WorkoutLogDoc,
  logExerciseId: string,
  substituteId: string | null,
  makeId: () => string,
  nowIso: string,
): WorkoutLogDoc {
  const blocks = log.blocks.map((b) => {
    const i = b.exercises.findIndex((e) => e.id === logExerciseId);
    const ex = b.exercises[i];
    if (!ex || ex.substituteId === substituteId || isSubstituteLocked(ex)) return b;
    const option = ex.substituteOptions.find((o) => o.substituteId === substituteId);
    const planned = ex.substituteOptions.find((o) => o.substituteId === null);
    if (!option || !planned) return b;
    const sets: LogSetDoc[] = option.sets.map((s) => ({
      id: makeId(),
      setType: s.setType,
      target: { ...s.target },
      actualReps: null,
      actualWeightKg: null,
      actualDurationS: null,
      actualDistanceM: null,
      completedAt: null,
    }));
    const chosen: LogExerciseDoc = {
      ...ex,
      exerciseId: option.exerciseId,
      exerciseName: option.exerciseName,
      trackingType: option.trackingType,
      substituteId,
      swappedFromExerciseId: substituteId === null ? null : planned.exerciseId,
      sets,
    };
    return { ...b, exercises: b.exercises.map((e, ei) => (ei === i ? chosen : e)) };
  });
  const changed = blocks.some((b, i) => b !== log.blocks[i]);
  if (!changed) return log;
  return { ...log, blocks, lastActivityAt: nowIso, revision: log.revision + 1 };
}

/** Back to the planned exercise; same rules as chooseSubstitute. */
export const clearSubstitute = (log: WorkoutLogDoc, logExerciseId: string, makeId: () => string, nowIso: string): WorkoutLogDoc =>
  chooseSubstitute(log, logExerciseId, null, makeId, nowIso);
