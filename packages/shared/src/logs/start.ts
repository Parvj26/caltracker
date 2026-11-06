import type { WorkoutDoc, WorkoutSetDoc } from '../workouts/schema';
import type { LogSetDoc, LogSetTarget, WorkoutLogDoc } from './schema';

function logSetFromPlan(s: WorkoutSetDoc, makeId: () => string): LogSetDoc {
  const target: LogSetTarget = {
    repsMin: s.targetRepsMin,
    repsMax: s.targetRepsMax,
    weightKg: s.targetWeightKg,
    durationS: s.targetDurationS,
    distanceM: s.targetDistanceM,
    toFailure: s.toFailure,
    restSeconds: s.restSeconds,
  };
  return { id: makeId(), setType: s.setType, target, actualReps: null, actualWeightKg: null, actualDurationS: null, actualDistanceM: null, completedAt: null };
}

export function startLogFromWorkout(workout: WorkoutDoc, makeId: () => string, nowIso: string): WorkoutLogDoc {
  return {
    id: makeId(),
    workoutId: workout.id,
    name: workout.name,
    status: 'in_progress',
    startedAt: nowIso,
    finishedAt: null,
    lastActivityAt: nowIso,
    autoFinished: false,
    revision: 0,
    notes: null,
    sections: workout.sections.map((s) => ({ ...s })),
    blocks: workout.blocks.map((b) => ({
      id: makeId(),
      sectionId: b.sectionId,
      pickedExerciseId: null,
      kind: b.kind,
      exercises: b.exercises.map((e) => ({
        id: makeId(),
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        trackingType: e.trackingType,
        plannedWorkoutExerciseId: e.id,
        swappedFromExerciseId: null,
        note: null,
        sets: e.sets.map((s) => logSetFromPlan(s, makeId)),
      })),
    })),
  };
}

export function emptyLog(name: string, makeId: () => string, nowIso: string): WorkoutLogDoc {
  return {
    id: makeId(),
    workoutId: null,
    name,
    status: 'in_progress',
    startedAt: nowIso,
    finishedAt: null,
    lastActivityAt: nowIso,
    autoFinished: false,
    revision: 0,
    notes: null,
    sections: [],
    blocks: [],
  };
}
