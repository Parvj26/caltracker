// Measurements, Each side and Tempo on a workout exercise: the doc, the DB row mapping, the builder ops and the
// log snapshot taken from the plan.
import { describe, expect, it } from 'vitest';
import { addStraightBlock, addSubstitute, emptyWorkout, replaceExercise, toggleExerciseMeasurement, updateExerciseOptions, updateSet } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';
import { WORKOUT_TREE_SELECT, workoutRowToDoc } from '../../src/workouts/tree';
import type { WorkoutTreeRow } from '../../src/workouts/tree';
import { startLogFromWorkout } from '../../src/logs/start';
import { chooseSubstitute, clearSubstitute } from '../../src/logs/substitutes';
import { swapLogExercise } from '../../src/logs/ops';
import { WorkoutLogDoc } from '../../src/logs/schema';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 5000;
const makeId = () => ID(++counter);
const T = '2026-11-10T10:00:00.000Z';

function oneExercise(trackingType: 'weight_reps' | 'distance' = 'weight_reps', eachSide?: boolean) {
  const d = addStraightBlock(emptyWorkout(makeId, 'Legs'), { id: ID(1), name: 'Lunge', trackingType, ...(eachSide === undefined ? {} : { eachSide }) }, makeId);
  const block = d.blocks[0]!;
  return { doc: { ...d }, blockId: block.id, exId: block.exercises[0]!.id };
}

describe('WorkoutDoc: Each side and Tempo', () => {
  it('reads a doc from before them as false / null', () => {
    const { doc } = oneExercise();
    const old: Record<string, unknown> = { ...doc.blocks[0]!.exercises[0]! };
    delete old.eachSide;
    delete old.tempo;
    const parsed = WorkoutDoc.parse({ ...doc, blocks: [{ ...doc.blocks[0], exercises: [old] }] });
    expect(parsed.blocks[0]!.exercises[0]).toMatchObject({ eachSide: false, tempo: null });
  });

  it('normalises a typed tempo and refuses a bad one on the tempo field', () => {
    const { doc, blockId, exId } = oneExercise();
    const ok = WorkoutDoc.parse(updateExerciseOptions(doc, blockId, exId, { tempo: ' 3-1-x-0 ', eachSide: true }));
    expect(ok.blocks[0]!.exercises[0]).toMatchObject({ eachSide: true, tempo: '3-1-X-0' });
    const blank = WorkoutDoc.parse(updateExerciseOptions(doc, blockId, exId, { tempo: '' }));
    expect(blank.blocks[0]!.exercises[0]!.tempo).toBeNull();
    const bad = WorkoutDoc.safeParse(updateExerciseOptions(doc, blockId, exId, { tempo: '3-1-1' }));
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]).toMatchObject({ path: ['blocks', 0, 'exercises', 0, 'tempo'] });
  });

  it('checks set targets against the chosen measurements', () => {
    const { doc, blockId, exId } = oneExercise();
    const setId = doc.blocks[0]!.exercises[0]!.sets[0]!.id;
    const timed = updateSet(doc, blockId, exId, setId, { targetDurationS: 45 });
    expect(WorkoutDoc.safeParse(timed).success).toBe(false);
    const withTime = updateSet(toggleExerciseMeasurement(doc, blockId, exId, 'time'), blockId, exId, setId, { targetDurationS: 45 });
    expect(WorkoutDoc.safeParse(withTime).success).toBe(true);
  });
});

describe('builder ops', () => {
  it('starts a new exercise with the pick’s each side and no tempo', () => {
    expect(oneExercise().doc.blocks[0]!.exercises[0]).toMatchObject({ eachSide: false, tempo: null });
    expect(oneExercise('weight_reps', true).doc.blocks[0]!.exercises[0]).toMatchObject({ eachSide: true });
  });

  it('toggling Time adds it; unticking Reps clears the rep targets; the last one stays', () => {
    const { doc, blockId, exId } = oneExercise();
    const setId = doc.blocks[0]!.exercises[0]!.sets[0]!.id;
    const withReps = updateSet(doc, blockId, exId, setId, { targetRepsMin: 8, targetRepsMax: 8, targetWeightKg: 20 });
    const timed = toggleExerciseMeasurement(withReps, blockId, exId, 'time');
    expect(timed.blocks[0]!.exercises[0]!.trackingType).toBe('weight_reps_time');
    const noReps = toggleExerciseMeasurement(timed, blockId, exId, 'reps');
    const ex = noReps.blocks[0]!.exercises[0]!;
    expect(ex.trackingType).toBe('weight_time');
    expect(ex.sets[0]).toMatchObject({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: 20 });
    const onlyTime = toggleExerciseMeasurement(noReps, blockId, exId, 'weight');
    expect(toggleExerciseMeasurement(onlyTime, blockId, exId, 'time')).toBe(onlyTime);
  });

  it('never changes a distance exercise', () => {
    const { doc, blockId, exId } = oneExercise('distance');
    expect(toggleExerciseMeasurement(doc, blockId, exId, 'reps')).toBe(doc);
  });

  it('a swap takes the new exercise’s measurements and each side, and keeps the tempo', () => {
    const { doc, blockId, exId } = oneExercise('weight_reps', true);
    const withTempo = updateExerciseOptions(doc, blockId, exId, { tempo: '3-1-1-0' });
    const swapped = replaceExercise(withTempo, blockId, exId, { id: ID(2), name: 'Plank', trackingType: 'time' });
    expect(swapped.blocks[0]!.exercises[0]).toMatchObject({ trackingType: 'time', eachSide: false, tempo: '3-1-1-0' });
  });
});

describe('workoutRowToDoc', () => {
  const row = (over: Record<string, unknown>): WorkoutTreeRow => ({
    id: ID(10),
    name: 'Legs',
    notes: null,
    client_id: null,
    scheduled_on: null,
    workout_blocks: [
      {
        id: ID(11),
        position: 0,
        kind: 'straight',
        section_id: null,
        section_name: null,
        workout_exercises: [
          {
            id: ID(12),
            position: 0,
            exercise_id: ID(1),
            note: null,
            exercises: { name: 'Lunge', tracking_type: 'weight_reps' },
            workout_sets: [
              {
                id: ID(13),
                position: 0,
                set_type: 'normal',
                target_reps_min: 8,
                target_reps_max: 8,
                target_weight_kg: 20,
                target_duration_s: 30,
                target_distance_m: null,
                to_failure: false,
                rest_seconds: 60,
                note: null,
              },
            ],
            ...over,
          },
        ],
      },
    ],
  });

  it('selects the new columns', () => {
    expect(WORKOUT_TREE_SELECT).toContain('note, tracking_type, each_side, tempo, exercises(name, tracking_type)');
  });

  it('uses the workout exercise’s own measurements over the library kind', () => {
    const doc = workoutRowToDoc(row({ tracking_type: 'weight_reps_time', each_side: true, tempo: '3-1-1-0' }));
    const ex = doc.blocks[0]!.exercises[0]!;
    expect(ex).toMatchObject({ trackingType: 'weight_reps_time', eachSide: true, tempo: '3-1-1-0' });
    expect(ex.sets[0]).toMatchObject({ targetRepsMax: 8, targetWeightKg: 20, targetDurationS: 30 });
    expect(WorkoutDoc.safeParse(doc).success).toBe(true);
  });

  it('ignores an override on a distance exercise (distance keeps its kind)', () => {
    const r = row({ tracking_type: 'time', exercises: { name: 'Run', tracking_type: 'distance' } });
    expect(workoutRowToDoc(r).blocks[0]!.exercises[0]!.trackingType).toBe('distance');
  });

  it('falls back to the library kind (dropping time) on a row from before, or with none', () => {
    const ex = workoutRowToDoc(row({})).blocks[0]!.exercises[0]!;
    expect(ex).toMatchObject({ trackingType: 'weight_reps', eachSide: false, tempo: null });
    expect(ex.sets[0]!.targetDurationS).toBeNull();
  });
});

describe('logs take the plan’s measurements, Each side and Tempo', () => {
  function plan() {
    const { doc, blockId, exId } = oneExercise();
    const opts = updateExerciseOptions(toggleExerciseMeasurement(doc, blockId, exId, 'time'), blockId, exId, { eachSide: true, tempo: '3-1-1-0' });
    return { doc: WorkoutDoc.parse(opts), blockId, exId };
  }

  it('snapshots them when a log starts', () => {
    const log = startLogFromWorkout(plan().doc, makeId, T);
    expect(log.blocks[0]!.exercises[0]).toMatchObject({ trackingType: 'weight_reps_time', eachSide: true, tempo: '3-1-1-0' });
    expect(WorkoutLogDoc.safeParse(log).success).toBe(true);
  });

  it('a substitute has none; going back to the plan brings them back', () => {
    const { doc, blockId, exId } = plan();
    const withSub = WorkoutDoc.parse(addSubstitute(doc, blockId, exId, { id: ID(3), name: 'Split Squat', trackingType: 'weight_reps' }, makeId));
    const log = startLogFromWorkout(withSub, makeId, T);
    const ex = log.blocks[0]!.exercises[0]!;
    const subId = ex.substituteOptions[1]!.substituteId!;
    const sub = chooseSubstitute(log, ex.id, subId, makeId, T);
    expect(sub.blocks[0]!.exercises[0]).toMatchObject({ trackingType: 'weight_reps', eachSide: false, tempo: null });
    const back = clearSubstitute(sub, ex.id, makeId, T);
    expect(back.blocks[0]!.exercises[0]).toMatchObject({ trackingType: 'weight_reps_time', eachSide: true, tempo: '3-1-1-0' });
  });

  it('a free swap drops them', () => {
    const log = startLogFromWorkout(plan().doc, makeId, T);
    const ex = log.blocks[0]!.exercises[0]!;
    const swapped = swapLogExercise(log, ex.id, { id: ID(4), name: 'Step Up', trackingType: 'reps' }, T);
    expect(swapped.blocks[0]!.exercises[0]).toMatchObject({ eachSide: false, tempo: null });
  });
});
