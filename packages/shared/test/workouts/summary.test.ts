import { describe, expect, it } from 'vitest';
import { exerciseSummaryLine, workoutSummaryRows } from '../../src/workouts/summary';
import type { WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '../../src/workouts/schema';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const LB = 0.45359237;
const set = (over: Partial<WorkoutSetDoc> = {}): WorkoutSetDoc => ({
  id: id(),
  setType: 'normal',
  targetRepsMin: 5,
  targetRepsMax: 5,
  targetWeightKg: null,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 60,
  note: null,
  ...over,
});
const exercise = (
  name: string,
  sets: WorkoutSetDoc[],
  trackingType: WorkoutExerciseDoc['trackingType'] = 'weight_reps',
): WorkoutExerciseDoc => ({ id: id(), exerciseId: id(), exerciseName: name, trackingType, note: null, sets, substitutes: [] });
const block = (kind: WorkoutBlockDoc['kind'], exercises: WorkoutExerciseDoc[]): WorkoutBlockDoc => ({
  id: id(),
  sectionId: null,
  kind,
  exercises,
});

describe('exerciseSummaryLine', () => {
  it('counts the sets and reads the heaviest working set', () => {
    const ex = exercise('Dumbbell Bench Press', [
      set({ setType: 'warmup', targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 50 * LB }),
      set({ targetWeightKg: 70 * LB }),
      set({ targetWeightKg: 75 * LB }),
      set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: 75 * LB, toFailure: true }),
    ]);
    expect(exerciseSummaryLine(ex, 'lb')).toBe('4 sets · 5 reps · 75 lb');
  });

  it('reads a time exercise as a clock', () => {
    const plank = exercise('Plank', [1, 2, 3].map(() => set({ targetRepsMin: null, targetRepsMax: null, targetDurationS: 45 })), 'time');
    expect(exerciseSummaryLine(plank, 'lb')).toBe('3 sets · 0:45');
  });

  it('leaves out a weight that is not set, and says 1 set', () => {
    expect(exerciseSummaryLine(exercise('Hanging Leg Raise', [set({ targetRepsMin: 12, targetRepsMax: 12 })], 'reps'), 'kg')).toBe(
      '1 set · 12 reps',
    );
    expect(exerciseSummaryLine(exercise('Squat', [set(), set()]), 'kg')).toBe('2 sets · 5 reps');
  });

  it('shows a rep range, kilograms and distance', () => {
    expect(exerciseSummaryLine(exercise('Row', [set({ targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 60 })]), 'kg')).toBe(
      '1 set · 8–10 reps · 60 kg',
    );
    const run = exercise('Run', [set({ targetRepsMin: null, targetRepsMax: null, targetDistanceM: 400 })], 'distance');
    expect(exerciseSummaryLine(run, 'kg')).toBe('1 set · 400 m');
  });

  it('does not count drop sets, and reads a set to failure', () => {
    const ex = exercise('Curl', [
      set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: 20, toFailure: true }),
      set({ setType: 'drop', targetRepsMin: null, targetRepsMax: null, targetWeightKg: 15, toFailure: true }),
    ]);
    expect(exerciseSummaryLine(ex, 'kg')).toBe('1 set · to failure · 20 kg');
  });

  it('says only the set count when no set has a target', () => {
    expect(exerciseSummaryLine(exercise('Stretch', [set({ targetRepsMin: null, targetRepsMax: null })], 'reps'), 'kg')).toBe('1 set');
  });
});

describe('workoutSummaryRows', () => {
  it('gives one row per exercise, a pick-one group as one row', () => {
    const rows = workoutSummaryRows(
      {
        blocks: [
          block('straight', [exercise('Squat', [set({ targetWeightKg: 100 })])]),
          block('superset', [exercise('Push-up', [set()], 'reps'), exercise('Pull-up', [set()], 'reps')]),
          block('choice', [exercise('Leg Press', [set(), set()]), exercise('Hack Squat', [set()])]),
        ],
      },
      'kg',
    );
    expect(rows.map((r) => [r.name, r.line])).toEqual([
      ['Squat', '1 set · 5 reps · 100 kg'],
      ['Push-up', '1 set · 5 reps'],
      ['Pull-up', '1 set · 5 reps'],
      ['Pick one: Leg Press or Hack Squat', '2 sets · 5 reps'],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(4);
  });
});
