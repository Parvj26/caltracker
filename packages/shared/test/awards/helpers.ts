import type { WorkoutLogDoc } from '../../src/logs/schema';
import type { SetType } from '../../src/workouts/schema';
import type { TrackingType } from '../../src/exercises/tracking';
import { uuid } from '../logs/fixture';

export type S = { w: number; r: number; type?: SetType; done?: boolean };

export const EX_A = '00000000-0000-4000-8000-0000000000aa';
export const EX_B = '00000000-0000-4000-8000-0000000000bb';

export function mkLog(
  exercises: Array<{ exerciseId?: string; trackingType?: TrackingType; sets: S[] }>,
  over: Partial<WorkoutLogDoc> = {},
): WorkoutLogDoc {
  return {
    id: uuid(),
    workoutId: null,
    name: 'Test',
    status: 'completed',
    startedAt: '2026-11-05T10:00:00.000Z',
    finishedAt: '2026-11-05T11:00:00.000Z',
    lastActivityAt: '2026-11-05T11:00:00.000Z',
    autoFinished: false,
    revision: 0,
    notes: null,
    blocks: exercises.map((e) => ({
      id: uuid(),
      kind: 'straight' as const,
      exercises: [
        {
          id: uuid(),
          exerciseId: e.exerciseId ?? EX_A,
          exerciseName: 'Lift',
          trackingType: e.trackingType ?? 'weight_reps',
          plannedWorkoutExerciseId: null,
          swappedFromExerciseId: null,
          note: null,
          sets: e.sets.map((s) => ({
            id: uuid(),
            setType: s.type ?? 'normal',
            target: { repsMin: null, repsMax: null, weightKg: null, durationS: null, distanceM: null, toFailure: false, restSeconds: null },
            actualReps: s.r,
            actualWeightKg: s.w,
            actualDurationS: null,
            actualDistanceM: null,
            completedAt: s.done === false ? null : '2026-11-05T10:30:00.000Z',
          })),
        },
      ],
    })),
    ...over,
  };
}

export const stats = (over: Partial<import('../../src/awards/rare').ClientStats> = {}) => ({
  workouts: 0,
  streak: 0,
  bestStreak: 0,
  prCount: 0,
  lifetimeVolumeKg: 0,
  monthVolumeKg: 0,
  ...over,
});
