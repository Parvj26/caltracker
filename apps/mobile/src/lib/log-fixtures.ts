// Test helpers for the log store and sync tests: an in-memory storage and a small valid log.
import type { WorkoutLogDoc } from '@caltracker/shared';
import type { KeyValueStorage } from './log-store';

export function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => Promise.resolve(map.get(k) ?? null),
    setItem: (k, v) => {
      map.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      map.delete(k);
      return Promise.resolve();
    },
  };
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function sampleLog(over: Partial<WorkoutLogDoc> = {}): WorkoutLogDoc {
  return {
    id: id(1),
    workoutId: null,
    name: 'Upper A',
    status: 'in_progress',
    startedAt: '2026-11-05T09:00:00.000Z',
    finishedAt: null,
    lastActivityAt: '2026-11-05T09:10:00.000Z',
    autoFinished: false,
    revision: 1,
    notes: null,
    sections: [],
    blocks: [
      {
        id: id(2),
        sectionId: null,
        pickedExerciseId: null,
        kind: 'straight',
        exercises: [
          {
            id: id(3),
            exerciseId: id(4),
            exerciseName: 'Bench press',
            trackingType: 'weight_reps',
            plannedWorkoutExerciseId: null,
            swappedFromExerciseId: null,
            note: null,
            sets: [
              {
                id: id(5),
                setType: 'normal',
                target: { repsMin: 8, repsMax: 10, weightKg: 60, durationS: null, distanceM: null, toFailure: false, restSeconds: 90 },
                actualReps: 8,
                actualWeightKg: 60,
                actualDurationS: null,
                actualDistanceM: null,
                completedAt: '2026-11-05T09:10:00.000Z',
              },
            ],
          },
        ],
      },
    ],
    ...over,
  };
}
