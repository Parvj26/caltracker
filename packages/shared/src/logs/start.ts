import type { WorkoutDoc, WorkoutSetDoc } from '../workouts/schema';
import type { LogSetDoc, LogSetTarget, WorkoutLogDoc } from './schema';

function planSnapshot(s: WorkoutSetDoc): { setType: WorkoutSetDoc['setType']; target: LogSetTarget } {
  const target: LogSetTarget = {
    repsMin: s.targetRepsMin,
    repsMax: s.targetRepsMax,
    weightKg: s.targetWeightKg,
    durationS: s.targetDurationS,
    distanceM: s.targetDistanceM,
    toFailure: s.toFailure,
    restSeconds: s.restSeconds,
  };
  return { setType: s.setType, target };
}

function logSetFromPlan(s: WorkoutSetDoc, makeId: () => string): LogSetDoc {
  return { id: makeId(), ...planSnapshot(s), actualReps: null, actualWeightKg: null, actualDurationS: null, actualDistanceM: null, completedAt: null };
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
        substituteId: null,
        substituteOptions:
          e.substitutes.length === 0
            ? []
            : [
                { substituteId: null, exerciseId: e.exerciseId, exerciseName: e.exerciseName, trackingType: e.trackingType, sets: e.sets },
                ...e.substitutes.map((sub) => ({
                  substituteId: sub.id,
                  exerciseId: sub.exerciseId,
                  exerciseName: sub.exerciseName,
                  trackingType: sub.trackingType,
                  sets: sub.sets,
                })),
              ].map((o) => ({ ...o, sets: o.sets.map((s) => planSnapshot(s)) })),
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
