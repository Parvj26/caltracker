import { describe, expect, it } from 'vitest';
import { workoutPreview } from '../../src/workouts/preview';
import type { WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '../../src/workouts/schema';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const set = (over: Partial<WorkoutSetDoc> = {}): WorkoutSetDoc => ({
  id: id(),
  setType: 'normal',
  targetRepsMin: 12,
  targetRepsMax: 12,
  targetWeightKg: null,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 60,
  note: null,
  ...over,
});
const exercise = (name: string, sets: WorkoutSetDoc[], trackingType: WorkoutExerciseDoc['trackingType'] = 'weight_reps'): WorkoutExerciseDoc => ({
  id: id(),
  exerciseId: id(),
  exerciseName: name,
  trackingType,
  note: null,
  sets,
  substitutes: [],
});
const block = (kind: WorkoutBlockDoc['kind'], exercises: WorkoutExerciseDoc[]): WorkoutBlockDoc => ({ id: id(), sectionId: null, kind, exercises });
const straight = (e: WorkoutExerciseDoc) => block('straight', [e]);

describe('workoutPreview', () => {
  it('shows the set count, name and sets of the first three exercises, and how many more', () => {
    const kg = 4.5359237; // 10 lb
    const doc = {
      blocks: [
        straight(exercise('Rainbow Squat', [set({ targetWeightKg: kg }), set({ targetWeightKg: kg }), set({ targetWeightKg: kg }), set({ targetWeightKg: kg })])),
        block('superset', [exercise('Push-up', [set(), set()], 'reps'), exercise('Plank', [set({ targetRepsMin: null, targetRepsMax: null, targetDurationS: 45 })], 'time')]),
        straight(exercise('Row', [set()])),
        straight(exercise('Curl', [set()])),
      ],
    };
    const p = workoutPreview(doc, 'lb');
    expect(p.lines.map((l) => l.text)).toEqual([
      '4× Rainbow Squat · 10 lb × 12, 10 lb × 12, 10 lb × 12, 10 lb × 12',
      '2× Push-up · 12 reps, 12 reps',
      '1× Plank · 45 s',
    ]);
    expect(p.lines[0]!.spoken).toBe('Rainbow Squat, 4 sets: 10 lb × 12, 10 lb × 12, 10 lb × 12, 10 lb × 12');
    expect(p.lines[2]!.spoken).toBe('Plank, 1 set: 45 s');
    expect(p.more).toBe(2);
  });

  it('does not count drop sets, and marks warm-ups and drops as the builder does', () => {
    const p = workoutPreview({ blocks: [straight(exercise('Bench', [set({ setType: 'warmup', targetWeightKg: 20 }), set({ targetWeightKg: 60 }), set({ setType: 'drop', targetWeightKg: 40 })]))] }, 'kg');
    expect(p.lines.map((l) => l.text)).toEqual(['2× Bench · W 20 kg × 12, 60 kg × 12, ↓ 40 kg × 12']);
    expect(p.more).toBe(0);
  });

  it('shows a pick-one group as one line', () => {
    const p = workoutPreview({ blocks: [block('choice', [exercise('Squat', [set()]), exercise('Leg Press', [set()])]), straight(exercise('Row', [set()]))] }, 'kg', 1);
    expect(p.lines.map((l) => l.text)).toEqual(['Pick one: Squat or Leg Press']);
    expect(p.more).toBe(1);
  });

  it('is empty for a workout with no exercises', () => {
    expect(workoutPreview({ blocks: [] }, 'kg')).toEqual({ lines: [], more: 0 });
  });
});
