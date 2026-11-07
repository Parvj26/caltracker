// An app build only knows the tracking types it shipped with. A newer server can send one it has never heard of
// (an older phone seeing 'weight_time', or a type added later). Reads must fall back instead of crashing; writes
// stay strict.
import { describe, expect, it } from 'vitest';
import { FALLBACK_TRACKING_TYPE, isTrackingType, toTrackingType } from '../../src/exercises/tracking';
import type { TrackingType } from '../../src/exercises/tracking';
import { exerciseIndexRowFromDb } from '../../src/exercises/search';
import { formatLastResult, formatResult } from '../../src/logs/format';
import { resolveSetValues } from '../../src/logs/prefill';
import { WorkoutLogDoc, parseWorkoutLogDocLenient } from '../../src/logs/schema';
import { logRowToDoc } from '../../src/logs/tree';
import type { LogTreeRow } from '../../src/logs/tree';
import { WorkoutDoc, parseWorkoutDocLenient } from '../../src/workouts/schema';
import { formatSetTarget, formatSetsSummary, targetFieldsFor, trackingTypeLabel } from '../../src/workouts/targets';
import { workoutRowToDoc } from '../../src/workouts/tree';
import type { WorkoutTreeRow } from '../../src/workouts/tree';

const FUTURE = 'sled_meters_per_minute' as unknown as TrackingType;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('toTrackingType', () => {
  it('keeps a known type and falls back to reps for anything else', () => {
    expect(FALLBACK_TRACKING_TYPE).toBe('reps');
    expect(toTrackingType('weight_time')).toBe('weight_time');
    expect(toTrackingType('distance')).toBe('distance');
    for (const v of ['sled_meters_per_minute', '', 'WEIGHT_REPS', null, undefined, 3, {}]) {
      expect(toTrackingType(v)).toBe('reps');
    }
    expect(isTrackingType('time')).toBe(true);
    expect(isTrackingType('nope')).toBe(false);
  });
});

describe('lookups by tracking type', () => {
  it('give an unknown type the reps fields and label instead of undefined', () => {
    expect(targetFieldsFor(FUTURE)).toEqual(['reps']);
    expect(trackingTypeLabel(FUTURE)).toBe('reps only');
    expect(targetFieldsFor('weight_time')).toEqual(['weight', 'duration']);
  });

  it('format sets and results of an unknown type as reps without throwing', () => {
    const set = {
      id: id(1),
      setType: 'normal' as const,
      targetRepsMin: 10,
      targetRepsMax: 10,
      targetWeightKg: 20,
      targetDurationS: 60,
      targetDistanceM: null,
      toFailure: false,
      restSeconds: 0,
      note: null,
    };
    expect(formatSetTarget(set, FUTURE, 'kg')).toBe('10 reps');
    expect(formatSetsSummary([set], FUTURE, 'kg').text).toBe('10 reps');
    const done = { setType: 'normal' as const, actualReps: 8, actualWeightKg: 20, actualDurationS: 60, actualDistanceM: null };
    expect(formatLastResult([done], FUTURE, 'kg')).toBe('Last time: 8 reps');
    expect(formatResult({ reps: null, weightKg: 20, durationS: 60, distanceM: null }, FUTURE, 'kg')).toBeNull();
  });

  it('pre-fill an unknown type as reps', () => {
    const s = {
      id: id(2),
      setType: 'normal' as const,
      target: { repsMin: 12, repsMax: 12, weightKg: 20, durationS: null, distanceM: null, toFailure: false, restSeconds: null },
      actualReps: null,
      actualWeightKg: null,
      actualDurationS: null,
      actualDistanceM: null,
      completedAt: null,
    };
    expect(resolveSetValues({ sets: [s], trackingType: FUTURE }, s.id, [])).toEqual({
      reps: 12,
      weightKg: null,
      durationS: null,
      distanceM: null,
    });
  });
});

describe('reading server rows with an unknown tracking type', () => {
  it('the exercise index reads it as reps', () => {
    const row = exerciseIndexRowFromDb({
      id: id(3),
      name: 'Future Carry',
      primary_muscles: [],
      secondary_muscles: [],
      equipment: null,
      category: null,
      tracking_type: FUTURE,
      source: 'builtin',
      image_paths: [],
    });
    expect(row.trackingType).toBe('reps');
  });

  it('a workout reads it as reps, keeping only the reps targets, and still passes the strict schema', () => {
    const row: WorkoutTreeRow = {
      id: id(10),
      name: 'Carry day',
      notes: null,
      client_id: null,
      scheduled_on: null,
      workout_blocks: [
        {
          id: id(11),
          position: 0,
          kind: 'straight',
          section_id: null,
          section_name: null,
          workout_exercises: [
            {
              id: id(12),
              position: 0,
              exercise_id: id(13),
              note: null,
              exercises: { name: 'Future Carry', tracking_type: FUTURE },
              workout_sets: [
                {
                  id: id(14),
                  position: 0,
                  set_type: 'normal',
                  target_reps_min: 10,
                  target_reps_max: 10,
                  target_weight_kg: '32',
                  target_duration_s: 60,
                  target_distance_m: null,
                  to_failure: false,
                  rest_seconds: 60,
                  note: null,
                },
              ],
              workout_substitutes: [
                {
                  id: id(15),
                  position: 0,
                  exercise_id: id(16),
                  note: null,
                  sets: [{ id: id(17), setType: 'normal', targetRepsMin: 8, targetWeightKg: 20, restSeconds: 0 }],
                  exercises: { name: 'Other Future Move', tracking_type: FUTURE },
                },
              ],
            },
          ],
        },
      ],
    };
    const doc = workoutRowToDoc(row);
    const ex = doc.blocks[0]!.exercises[0]!;
    expect(ex.trackingType).toBe('reps');
    expect(ex.sets[0]).toMatchObject({ targetRepsMin: 10, targetWeightKg: null, targetDurationS: null });
    expect(ex.substitutes.map((s) => [s.trackingType, s.sets[0]!.targetWeightKg])).toEqual([['reps', null]]);
    expect(WorkoutDoc.safeParse(doc).success).toBe(true);
  });

  it('a log reads it as reps and keeps every logged number and substitute option', () => {
    const option = (substituteId: string | null, exerciseId: string) => ({
      substituteId,
      exerciseId,
      exerciseName: 'Future Carry',
      trackingType: 'sled_meters_per_minute',
      note: null,
      sets: [
        {
          setType: 'normal',
          target: { repsMin: null, repsMax: null, weightKg: 32, durationS: 60, distanceM: null, toFailure: false, restSeconds: 0 },
        },
      ],
    });
    const row = {
      id: id(20),
      workout_id: null,
      name: 'Carry day',
      status: 'in_progress',
      started_at: '2026-11-06T09:00:00+00:00',
      finished_at: null,
      last_activity_at: '2026-11-06T09:00:00+00:00',
      auto_finished: false,
      revision: 1,
      notes: null,
      log_blocks: [
        {
          id: id(21),
          position: 0,
          kind: 'straight',
          section_id: null,
          section_name: null,
          picked_exercise_id: null,
          log_exercises: [
            {
              id: id(22),
              position: 0,
              exercise_id: id(23),
              planned_workout_exercise_id: null,
              swapped_from_exercise_id: null,
              note: null,
              substitute_id: null,
              substitute_options: [option(null, id(23)), option(id(25), id(26))],
              exercises: { name: 'Future Carry', tracking_type: FUTURE },
              log_sets: [
                {
                  id: id(24),
                  position: 0,
                  set_type: 'normal',
                  target_reps_min: null,
                  target_reps_max: null,
                  target_weight_kg: '32',
                  target_duration_s: 60,
                  target_distance_m: null,
                  to_failure: false,
                  rest_seconds: 0,
                  actual_reps: null,
                  actual_weight_kg: '32',
                  actual_duration_s: 55,
                  actual_distance_m: null,
                  completed_at: '2026-11-06T09:05:00+00:00',
                },
              ],
            },
          ],
        },
      ],
    } as unknown as LogTreeRow;
    const doc = logRowToDoc(row);
    const ex = doc.blocks[0]!.exercises[0]!;
    expect(ex.trackingType).toBe('reps');
    expect(ex.sets[0]).toMatchObject({ actualWeightKg: 32, actualDurationS: 55 });
    expect(ex.substituteOptions.map((o) => o.trackingType)).toEqual(['reps', 'reps']);
    expect(WorkoutLogDoc.safeParse(doc).success).toBe(true);
  });
});

describe('parsing docs saved on the phone', () => {
  const workout = (trackingType: string) => ({
    id: id(30),
    name: 'Carry day',
    notes: null,
    sections: [],
    blocks: [
      {
        id: id(31),
        sectionId: null,
        kind: 'straight',
        exercises: [
          {
            id: id(32),
            exerciseId: id(33),
            exerciseName: 'Future Carry',
            trackingType,
            note: null,
            sets: [
              {
                id: id(34),
                setType: 'normal',
                targetRepsMin: 10,
                targetRepsMax: 10,
                targetWeightKg: 32,
                targetDurationS: 60,
                targetDistanceM: null,
                toFailure: false,
                restSeconds: 60,
                note: null,
              },
            ],
            substitutes: [
              {
                id: id(35),
                exerciseId: id(36),
                exerciseName: 'Other',
                trackingType,
                note: null,
                sets: [
                  {
                    id: id(37),
                    setType: 'normal',
                    targetRepsMin: 5,
                    targetRepsMax: 5,
                    targetWeightKg: 20,
                    targetDurationS: null,
                    targetDistanceM: null,
                    toFailure: false,
                    restSeconds: 0,
                    note: null,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  it('a workout: the strict schema (writes) refuses an unknown type, the lenient read falls back to reps', () => {
    expect(WorkoutDoc.safeParse(workout('sled_meters_per_minute')).success).toBe(false);
    const read = parseWorkoutDocLenient(workout('sled_meters_per_minute'));
    expect(read.success).toBe(true);
    const ex = read.success ? read.data.blocks[0]!.exercises[0]! : null;
    expect(ex?.trackingType).toBe('reps');
    expect(ex?.sets[0]).toMatchObject({ targetRepsMin: 10, targetWeightKg: null, targetDurationS: null });
    expect(ex?.substitutes[0]).toMatchObject({ trackingType: 'reps' });
    expect(ex?.substitutes[0]!.sets[0]!.targetWeightKg).toBeNull();
  });

  it('a workout with known types reads exactly as the strict schema does', () => {
    const doc = workout('weight_time');
    doc.blocks[0]!.exercises[0]!.sets[0]!.targetRepsMin = null as unknown as number;
    doc.blocks[0]!.exercises[0]!.sets[0]!.targetRepsMax = null as unknown as number;
    doc.blocks[0]!.exercises[0]!.substitutes = [];
    const strict = WorkoutDoc.safeParse(doc);
    expect(strict.success).toBe(true);
    expect(parseWorkoutDocLenient(doc)).toEqual(strict);
    expect(parseWorkoutDocLenient('not a doc').success).toBe(false);
  });

  it('a log: the strict schema refuses an unknown type, the lenient read falls back to reps and keeps the numbers', () => {
    const target = { repsMin: null, repsMax: null, weightKg: 32, durationS: 60, distanceM: null, toFailure: false, restSeconds: 0 };
    const log = {
      id: id(40),
      workoutId: null,
      name: 'Carry day',
      status: 'in_progress',
      startedAt: '2026-11-06T09:00:00.000Z',
      finishedAt: null,
      lastActivityAt: '2026-11-06T09:00:00.000Z',
      autoFinished: false,
      revision: 1,
      notes: null,
      sections: [],
      blocks: [
        {
          id: id(41),
          sectionId: null,
          pickedExerciseId: null,
          kind: 'straight',
          exercises: [
            {
              id: id(42),
              exerciseId: id(43),
              exerciseName: 'Future Carry',
              trackingType: 'sled_meters_per_minute',
              plannedWorkoutExerciseId: null,
              swappedFromExerciseId: null,
              note: null,
              substituteId: null,
              substituteOptions: [
                { substituteId: null, exerciseId: id(43), exerciseName: 'Future Carry', trackingType: 'x', note: null, sets: [{ setType: 'normal', target }] },
                { substituteId: id(45), exerciseId: id(46), exerciseName: 'Rows', trackingType: 'weight_reps', note: null, sets: [{ setType: 'normal', target }] },
              ],
              sets: [
                {
                  id: id(44),
                  setType: 'normal',
                  target,
                  actualReps: null,
                  actualWeightKg: 32,
                  actualDurationS: 55,
                  actualDistanceM: null,
                  completedAt: '2026-11-06T09:05:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(WorkoutLogDoc.safeParse(log).success).toBe(false);
    const read = parseWorkoutLogDocLenient(log);
    expect(read.success).toBe(true);
    const ex = read.success ? read.data.blocks[0]!.exercises[0]! : null;
    expect(ex?.trackingType).toBe('reps');
    expect(ex?.sets[0]).toMatchObject({ actualWeightKg: 32, actualDurationS: 55 });
    expect(ex?.substituteOptions.map((o) => o.trackingType)).toEqual(['reps', 'weight_reps']);
  });
});
