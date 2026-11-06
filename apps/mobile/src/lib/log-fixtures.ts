// Test helpers for the log store and sync tests: an in-memory storage and a small valid log.
import {
  WorkoutDoc,
  addChoice,
  addSection,
  addStraightBlock,
  emptyWorkout,
  startLogFromWorkout,
  type ExercisePick,
  type WorkoutLogDoc,
} from '@caltracker/shared';
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
            substituteId: null,
            substituteOptions: [],
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

/**
 * Upper / Core, started: Warm-Up [Jumping jacks], Core (Activation) [Plank], Resistance Training [Squat, Bench press,
 * Row], Finisher [pick one: Medicine Ball Slam / Farmer's Walk]. Pages 0 to 5; the pick-one group is page 5, unpicked.
 */
export function upperCoreLog(): WorkoutLogDoc {
  let n = 100;
  const makeId = () => id(++n);
  const pick = (name: string): ExercisePick => ({ id: makeId(), name, trackingType: 'weight_reps' });
  let d = emptyWorkout(makeId, 'Upper / Core');
  d = addSection(d, 'Warm-Up', makeId);
  d = addStraightBlock(d, pick('Jumping jacks'), makeId);
  d = addSection(d, 'Core (Activation)', makeId);
  d = addStraightBlock(d, pick('Plank'), makeId);
  d = addSection(d, 'Resistance Training', makeId);
  d = addStraightBlock(d, pick('Squat'), makeId);
  d = addStraightBlock(d, pick('Bench press'), makeId);
  d = addStraightBlock(d, pick('Row'), makeId);
  d = addSection(d, 'Finisher', makeId);
  d = addChoice(d, [pick('Medicine Ball Slam'), pick("Farmer's Walk")], makeId);
  return startLogFromWorkout(WorkoutDoc.parse(d), makeId, '2026-11-06T10:00:00.000Z');
}
