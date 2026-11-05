import { describe, expect, it } from 'vitest';
import { WorkoutDoc } from '../../src/workouts/schema';
import { WORKOUT_TREE_SELECT, workoutRowToDoc } from '../../src/workouts/tree';
import type { WorkoutTreeRow } from '../../src/workouts/tree';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const set = (n: number, position: number, over: Partial<WorkoutTreeRow['workout_blocks'][number]['workout_exercises'][number]['workout_sets'][number]> = {}) => ({
  id: id(n),
  position,
  set_type: 'normal' as const,
  target_reps_min: 8,
  target_reps_max: 10,
  target_weight_kg: 60 as number | string | null,
  target_duration_s: null,
  target_distance_m: null as number | string | null,
  to_failure: false,
  rest_seconds: 90,
  note: null,
  ...over,
});

// Positions are deliberately shuffled at every level, as PostgREST does not promise embed order.
const row: WorkoutTreeRow = {
  id: id(1),
  name: 'Upper A',
  notes: 'Go steady.',
  client_id: null,
  scheduled_on: null,
  workout_blocks: [
    {
      id: id(30),
      position: 1,
      kind: 'superset',
      workout_exercises: [
        {
          id: id(32),
          position: 1,
          exercise_id: id(902),
          note: null,
          exercises: { name: 'Pullups', tracking_type: 'reps' },
          workout_sets: [
            set(41, 1, { target_weight_kg: null, rest_seconds: 90 }),
            set(40, 0, { target_weight_kg: null, rest_seconds: 90 }),
          ],
        },
        {
          id: id(31),
          position: 0,
          exercise_id: id(901),
          note: 'Chest to floor.',
          exercises: { name: 'Pushups', tracking_type: 'reps' },
          workout_sets: [
            set(43, 1, { target_weight_kg: null, rest_seconds: 0 }),
            set(42, 0, { target_weight_kg: null, rest_seconds: 0 }),
          ],
        },
      ],
    },
    {
      id: id(10),
      position: 0,
      kind: 'straight',
      workout_exercises: [
        {
          id: id(11),
          position: 0,
          exercise_id: id(900),
          note: null,
          exercises: { name: 'Barbell Squat', tracking_type: 'weight_reps' },
          workout_sets: [
            set(23, 3, { set_type: 'drop', target_reps_min: null, target_reps_max: null, target_weight_kg: null, to_failure: true, rest_seconds: 0 }),
            set(21, 1, { target_weight_kg: '61.235' }),
            set(20, 0, { set_type: 'warmup', target_weight_kg: '40.000' }),
            set(22, 2, { note: 'Last one.' }),
          ],
        },
      ],
    },
  ],
};

describe('workoutRowToDoc', () => {
  it('orders blocks, exercises and sets by position and passes the schema', () => {
    const doc = workoutRowToDoc(row);
    expect(doc.blocks.map((b) => b.id)).toEqual([id(10), id(30)]);
    expect(doc.blocks[1]!.exercises.map((e) => e.exerciseName)).toEqual(['Pushups', 'Pullups']);
    expect(doc.blocks[0]!.exercises[0]!.sets.map((s) => s.id)).toEqual([id(20), id(21), id(22), id(23)]);
    expect(doc.blocks[0]!.exercises[0]!.sets.map((s) => s.setType)).toEqual(['warmup', 'normal', 'normal', 'drop']);
    expect(WorkoutDoc.parse(doc)).toEqual(doc);
  });

  it('maps columns to doc fields', () => {
    const doc = workoutRowToDoc(row);
    expect(doc).toMatchObject({ id: id(1), name: 'Upper A', notes: 'Go steady.' });
    expect(doc.blocks[1]).toMatchObject({ kind: 'superset' });
    expect(doc.blocks[1]!.exercises[0]).toMatchObject({
      id: id(31),
      exerciseId: id(901),
      exerciseName: 'Pushups',
      trackingType: 'reps',
      note: 'Chest to floor.',
    });
    expect(doc.blocks[0]!.exercises[0]!.sets[2]).toEqual({
      id: id(22),
      setType: 'normal',
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetWeightKg: 60,
      targetDurationS: null,
      targetDistanceM: null,
      toFailure: false,
      restSeconds: 90,
      note: 'Last one.',
    });
    expect(doc.blocks[0]!.exercises[0]!.sets[3]).toMatchObject({ toFailure: true, restSeconds: 0 });
  });

  it('turns numeric columns that arrive as strings into numbers', () => {
    const doc = workoutRowToDoc({
      ...row,
      workout_blocks: [
        {
          ...row.workout_blocks[1]!,
          workout_exercises: [
            {
              ...row.workout_blocks[1]!.workout_exercises[0]!,
              exercises: { name: 'Rowing', tracking_type: 'distance' },
              workout_sets: [set(50, 0, { target_reps_min: null, target_reps_max: null, target_weight_kg: null, target_distance_m: '2000.50' })],
            },
          ],
        },
      ],
    });
    const sets = workoutRowToDoc(row).blocks[0]!.exercises[0]!.sets;
    expect(sets[1]!.targetWeightKg).toBe(61.235);
    expect(sets[0]!.targetWeightKg).toBe(40);
    expect(doc.blocks[0]!.exercises[0]!.sets[0]!.targetDistanceM).toBe(2000.5);
  });

  it('does not mutate the row', () => {
    const before = JSON.stringify(row);
    workoutRowToDoc(row);
    expect(JSON.stringify(row)).toBe(before);
  });

  it('selects every level the mapping reads', () => {
    for (const part of ['workout_blocks(', 'workout_exercises(', 'exercises(name, tracking_type)', 'workout_sets(', 'position']) {
      expect(WORKOUT_TREE_SELECT).toContain(part);
    }
  });
});
