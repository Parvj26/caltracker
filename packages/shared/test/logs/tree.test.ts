import { describe, expect, it } from 'vitest';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { LOG_TREE_SELECT, logRowToDoc } from '../../src/logs/tree';
import type { LogTreeRow, LogTreeSetRow } from '../../src/logs/tree';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const set = (n: number, position: number, over: Partial<LogTreeSetRow> = {}): LogTreeSetRow => ({
  id: id(n),
  position,
  set_type: 'normal',
  target_reps_min: 8,
  target_reps_max: 10,
  target_weight_kg: 60,
  target_duration_s: null,
  target_distance_m: null,
  to_failure: false,
  rest_seconds: 90,
  actual_reps: null,
  actual_weight_kg: null,
  actual_duration_s: null,
  actual_distance_m: null,
  completed_at: null,
  ...over,
});

// Positions are deliberately shuffled at every level, as PostgREST does not promise embed order.
const row: LogTreeRow = {
  id: id(1),
  workout_id: id(2),
  name: 'Upper A',
  status: 'in_progress',
  started_at: '2026-11-05T09:00:00+00:00',
  finished_at: null,
  last_activity_at: '2026-11-05T09:20:00+00:00',
  auto_finished: false,
  revision: 6,
  notes: 'Felt strong.',
  log_blocks: [
    {
      id: id(30),
      position: 1,
      kind: 'superset',
      section_id: null,
      section_name: null,
      picked_exercise_id: null,
      log_exercises: [
        {
          id: id(32),
          position: 1,
          exercise_id: id(902),
          planned_workout_exercise_id: null,
          swapped_from_exercise_id: null,
          note: null,
          exercises: { name: 'Pullups', tracking_type: 'reps' },
          log_sets: [set(41, 1, { target_weight_kg: null }), set(40, 0, { target_weight_kg: null })],
        },
        {
          id: id(31),
          position: 0,
          exercise_id: id(901),
          planned_workout_exercise_id: id(801),
          swapped_from_exercise_id: id(700),
          note: 'Chest to floor.',
          exercises: { name: 'Pushups', tracking_type: 'reps' },
          log_sets: [
            set(43, 1, { target_weight_kg: null, rest_seconds: 0 }),
            set(42, 0, { target_weight_kg: null, rest_seconds: 0, actual_reps: 15, completed_at: '2026-11-05T09:15:00+00:00' }),
          ],
        },
      ],
    },
    {
      id: id(10),
      position: 0,
      kind: 'straight',
      section_id: null,
      section_name: null,
      picked_exercise_id: null,
      log_exercises: [
        {
          id: id(11),
          position: 0,
          exercise_id: id(900),
          planned_workout_exercise_id: id(800),
          swapped_from_exercise_id: null,
          note: null,
          exercises: { name: 'Barbell Squat', tracking_type: 'weight_reps' },
          log_sets: [
            set(23, 3, {
              set_type: 'drop',
              target_reps_min: null,
              target_reps_max: null,
              target_weight_kg: null,
              to_failure: true,
              rest_seconds: 0,
            }),
            set(21, 1, { target_weight_kg: '61.235', actual_reps: 8, actual_weight_kg: '61.235', completed_at: '2026-11-05T09:10:00+00:00' }),
            set(20, 0, { set_type: 'warmup', target_weight_kg: '40.000', actual_reps: 10, actual_weight_kg: 40, completed_at: '2026-11-05T09:05:00+00:00' }),
            set(22, 2, { rest_seconds: null }),
          ],
        },
      ],
    },
  ],
};

describe('logRowToDoc', () => {
  it('orders blocks, exercises and sets by position and passes the schema', () => {
    const doc = logRowToDoc(row);
    expect(doc.blocks.map((b) => b.id)).toEqual([id(10), id(30)]);
    expect(doc.blocks[1]!.exercises.map((e) => e.exerciseName)).toEqual(['Pushups', 'Pullups']);
    expect(doc.blocks[0]!.exercises[0]!.sets.map((s) => s.id)).toEqual([id(20), id(21), id(22), id(23)]);
    expect(doc.blocks[0]!.exercises[0]!.sets.map((s) => s.setType)).toEqual(['warmup', 'normal', 'normal', 'drop']);
    expect(WorkoutLogDoc.parse(doc)).toEqual(doc);
  });

  it('maps the log columns to doc fields', () => {
    expect(logRowToDoc(row)).toMatchObject({
      id: id(1),
      workoutId: id(2),
      name: 'Upper A',
      status: 'in_progress',
      startedAt: '2026-11-05T09:00:00+00:00',
      finishedAt: null,
      lastActivityAt: '2026-11-05T09:20:00+00:00',
      autoFinished: false,
      revision: 6,
      notes: 'Felt strong.',
    });
  });

  it('maps exercise columns, including the plan link and the swap', () => {
    const doc = logRowToDoc(row);
    expect(doc.blocks[1]).toMatchObject({ kind: 'superset' });
    const { sets, ...pushups } = doc.blocks[1]!.exercises[0]!;
    expect(pushups).toEqual({
      id: id(31),
      exerciseId: id(901),
      exerciseName: 'Pushups',
      trackingType: 'reps',
      plannedWorkoutExerciseId: id(801),
      swappedFromExerciseId: id(700),
      note: 'Chest to floor.',
    });
    expect(sets).toHaveLength(2);
  });

  it('maps a set into its planned target and what was actually done', () => {
    const sets = logRowToDoc(row).blocks[0]!.exercises[0]!.sets;
    expect(sets[1]).toEqual({
      id: id(21),
      setType: 'normal',
      target: {
        repsMin: 8,
        repsMax: 10,
        weightKg: 61.235,
        durationS: null,
        distanceM: null,
        toFailure: false,
        restSeconds: 90,
      },
      actualReps: 8,
      actualWeightKg: 61.235,
      actualDurationS: null,
      actualDistanceM: null,
      completedAt: '2026-11-05T09:10:00+00:00',
    });
    expect(sets[2]!.target.restSeconds).toBeNull();
    expect(sets[3]!.target).toMatchObject({ toFailure: true, restSeconds: 0, repsMin: null });
    expect(sets[3]!.completedAt).toBeNull();
  });

  it('turns numeric columns that arrive as strings into numbers', () => {
    const doc = logRowToDoc({
      ...row,
      log_blocks: [
        {
          ...row.log_blocks[1]!,
          log_exercises: [
            {
              ...row.log_blocks[1]!.log_exercises[0]!,
              exercises: { name: 'Rowing', tracking_type: 'distance' },
              log_sets: [
                set(50, 0, {
                  target_reps_min: null,
                  target_reps_max: null,
                  target_weight_kg: null,
                  target_distance_m: '2000.50',
                  actual_distance_m: '1999.00',
                  actual_weight_kg: '0.000',
                }),
              ],
            },
          ],
        },
      ],
    });
    const s = doc.blocks[0]!.exercises[0]!.sets[0]!;
    expect(s.target.distanceM).toBe(2000.5);
    expect(s.actualDistanceM).toBe(1999);
    expect(s.actualWeightKg).toBe(0);
    expect(logRowToDoc(row).blocks[0]!.exercises[0]!.sets[0]!.target.weightKg).toBe(40);
  });

  it('keeps a finished, auto-finished log as stored', () => {
    const doc = logRowToDoc({
      ...row,
      status: 'completed',
      finished_at: '2026-11-05T09:15:00+00:00',
      auto_finished: true,
    });
    expect(doc).toMatchObject({ status: 'completed', finishedAt: '2026-11-05T09:15:00+00:00', autoFinished: true });
    expect(WorkoutLogDoc.parse(doc)).toEqual(doc);
  });

  it('maps a log with no blocks', () => {
    const doc = logRowToDoc({ ...row, workout_id: null, notes: null, log_blocks: [] });
    expect(doc).toMatchObject({ workoutId: null, notes: null, blocks: [] });
  });

  it('falls back when the exercise row cannot be read', () => {
    const ex = logRowToDoc({
      ...row,
      log_blocks: [{ ...row.log_blocks[1]!, log_exercises: [{ ...row.log_blocks[1]!.log_exercises[0]!, exercises: null }] }],
    }).blocks[0]!.exercises[0]!;
    expect(ex).toMatchObject({ exerciseName: '', trackingType: 'weight_reps' });
  });

  it('does not mutate the row', () => {
    const before = JSON.stringify(row);
    logRowToDoc(row);
    expect(JSON.stringify(row)).toBe(before);
  });

  it('selects every level the mapping reads, naming which exercise link to follow', () => {
    for (const part of [
      'log_blocks(',
      'log_exercises(',
      // log_exercises links to exercises twice (the exercise and the one it was swapped from).
      'exercises!log_exercises_exercise_id_fkey(name, tracking_type)',
      'log_sets(',
      'planned_workout_exercise_id',
      'swapped_from_exercise_id',
      'completed_at',
      'revision',
      'position',
    ]) {
      expect(LOG_TREE_SELECT).toContain(part);
    }
  });
});

describe('logRowToDoc sections and pick', () => {
  const S1 = id(500);
  it('round-trips sections and the pick', () => {
    const [b1, b0] = [row.log_blocks[0]!, row.log_blocks[1]!];
    const picked = b1.log_exercises[0]!.id;
    const doc = logRowToDoc({
      ...row,
      log_blocks: [
        { ...b1, kind: 'choice', section_id: S1, section_name: 'Main', picked_exercise_id: picked },
        { ...b0, id: id(60), position: 0, section_id: S1, section_name: 'Main' },
      ],
    });
    expect(doc.sections).toEqual([{ id: S1, name: 'Main' }]);
    expect(doc.blocks.map((b) => b.sectionId)).toEqual([S1, S1]);
    expect(doc.blocks[1]!.pickedExerciseId).toBe(picked);
    expect(doc.blocks[0]!.pickedExerciseId).toBeNull();
  });

  it('gives no sections when the section columns are null', () => {
    const doc = logRowToDoc(row);
    expect(doc.sections).toEqual([]);
    expect(doc.blocks.every((b) => b.sectionId === null && b.pickedExerciseId === null)).toBe(true);
  });

  it('selects the new columns', () => {
    expect(LOG_TREE_SELECT).toContain('section_id, section_name, picked_exercise_id');
  });
});
