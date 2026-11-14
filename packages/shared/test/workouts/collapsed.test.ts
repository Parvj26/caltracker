import { describe, expect, it } from 'vitest';
import { blockCollapsedSummary, exerciseCollapsedLine, stepReps, stepWeight, weightStep } from '../../src/workouts/collapsed';
import type { WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '../../src/workouts/schema';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const LB = 0.45359237;
const set = (over: Partial<WorkoutSetDoc> = {}): WorkoutSetDoc => ({
  id: id(),
  setType: 'normal',
  targetRepsMin: 8,
  targetRepsMax: 8,
  targetWeightKg: 60,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 90,
  note: null,
  ...over,
});
const exercise = (
  name: string,
  sets: WorkoutSetDoc[],
  over: Partial<WorkoutExerciseDoc> = {},
): WorkoutExerciseDoc => ({
  id: id(),
  exerciseId: id(),
  exerciseName: name,
  trackingType: 'weight_reps',
  note: null,
  sets,
  substitutes: [],
  ...over,
});
const block = (kind: WorkoutBlockDoc['kind'], exercises: WorkoutExerciseDoc[]): WorkoutBlockDoc => ({
  id: id(),
  sectionId: null,
  kind,
  exercises,
});
const times = (k: number, over: Partial<WorkoutSetDoc> = {}) => Array.from({ length: k }, () => set(over));

describe('exerciseCollapsedLine', () => {
  it('reads equal sets as count × reps @ weight · rest', () => {
    expect(exerciseCollapsedLine(exercise('Bench Press', times(4)), 'kg')).toBe('4 × 8 @ 60 kg · rest 1:30');
  });

  it('shows ranges when the sets differ', () => {
    const ex = exercise('Incline DB Press', [
      set({ targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 22, restSeconds: 60 }),
      set({ targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 22, restSeconds: 60 }),
      set({ targetRepsMin: 8, targetRepsMax: 8, targetWeightKg: 24, restSeconds: 90 }),
    ]);
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('3 × 8–10 @ 22–24 kg · rest 1:00–1:30');
  });

  it('keeps an older rep range', () => {
    expect(exerciseCollapsedLine(exercise('Row', times(3, { targetRepsMin: 8, targetRepsMax: 12 })), 'kg')).toBe(
      '3 × 8–12 @ 60 kg · rest 1:30',
    );
  });

  it('shows weights in pounds', () => {
    expect(exerciseCollapsedLine(exercise('Squat', times(5, { targetRepsMin: 5, targetRepsMax: 5, targetWeightKg: 135 * LB })), 'lb')).toBe(
      '5 × 5 @ 135 lb · rest 1:30',
    );
  });

  it('marks each side and tempo', () => {
    const ex = exercise('Split Squat', times(3, { targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 12 }), {
      eachSide: true,
      tempo: '3-1-1-0',
    });
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('3 × 10 each side @ 12 kg · rest 1:30 · tempo 3-1-1-0');
  });

  it('says "N sets" when no target is filled in', () => {
    const ex = exercise('Plank', times(3, { targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, restSeconds: 0 }));
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('3 sets');
    expect(exerciseCollapsedLine(exercise('One', [set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, restSeconds: 0 })]), 'kg')).toBe('1 set');
  });

  it('leaves out an empty weight and a zero rest', () => {
    expect(exerciseCollapsedLine(exercise('Pull-up', times(3, { targetWeightKg: null, restSeconds: 0 })), 'kg')).toBe('3 × 8');
  });

  it('counts warm-ups, drops and failure sets apart from the working sets', () => {
    const ex = exercise('Bench Press', [
      set({ setType: 'warmup', targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 20 }),
      set(),
      set(),
      set({ toFailure: true, targetRepsMin: null, targetRepsMax: null }),
      set({ setType: 'drop', targetWeightKg: 40, restSeconds: 0 }),
    ]);
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('1 warm-up + 3 × 8 @ 60 kg · last to failure · 1 drop set · rest 1:30');
  });

  it('reads all-failure sets as "to failure"', () => {
    const ex = exercise('Push-up', times(3, { toFailure: true, targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, restSeconds: 60 }), {
      trackingType: 'reps',
    });
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('3 × to failure · rest 1:00');
  });

  it('reads time, distance and weight-only exercises', () => {
    const time = exercise('Plank', times(3, { targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, targetDurationS: 45, restSeconds: 30 }), {
      trackingType: 'time',
    });
    expect(exerciseCollapsedLine(time, 'kg')).toBe('3 × 0:45 · rest 0:30');
    const run = exercise('Run', times(2, { targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, targetDistanceM: 400, restSeconds: 0 }), {
      trackingType: 'distance',
    });
    expect(exerciseCollapsedLine(run, 'kg')).toBe('2 × 400 m');
    const carry = exercise('Farmer Carry', times(3, { targetRepsMin: null, targetRepsMax: null, targetWeightKg: 32, targetDurationS: 30, restSeconds: 0 }), {
      trackingType: 'weight_time',
    });
    expect(exerciseCollapsedLine(carry, 'kg')).toBe('3 × 0:30 @ 32 kg');
    const hold = exercise('Hold', times(2, { targetRepsMin: null, targetRepsMax: null, targetWeightKg: 20, restSeconds: 0 }), { trackingType: 'weight' });
    expect(exerciseCollapsedLine(hold, 'kg')).toBe('2 sets @ 20 kg');
  });

  it('ignores targets the tracking type does not use', () => {
    const ex = exercise('Air Squat', times(2, { targetWeightKg: 60, restSeconds: 0 }), { trackingType: 'reps' });
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('2 × 8');
  });

  it('counts only the filled sets and names the empty ones', () => {
    const blank = { targetRepsMin: null, targetRepsMax: null, targetWeightKg: null };
    const ex = exercise('Bench Press', [set({ targetRepsMin: 101, targetRepsMax: 101, targetWeightKg: 27.5 }), set(blank), set(blank)]);
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('1 × 101 @ 27.5 kg + 2 empty sets · rest 1:30');
    const one = exercise('Row', [set(), set(), set(blank)]);
    expect(exerciseCollapsedLine(one, 'kg')).toBe('2 × 8 @ 60 kg + 1 empty set · rest 1:30');
  });

  it('counts a set with only a weight as filled, and keeps warm-ups in front', () => {
    const ex = exercise('Squat', [
      set({ setType: 'warmup', targetWeightKg: 20 }),
      set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: 80 }),
      set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: null }),
    ]);
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('1 warm-up + 1 set @ 80 kg + 1 empty set · rest 1:30');
  });

  it('does not call a failure set empty', () => {
    const ex = exercise('Dip', [set(), set({ toFailure: true, targetRepsMin: null, targetRepsMax: null, targetWeightKg: null })], {
      trackingType: 'weight_reps',
    });
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('2 × 8 @ 60 kg · last to failure · rest 1:30');
  });

  it('shows a rep range as a range, as the summary card does', () => {
    const ex = exercise('Lunge', times(3, { targetRepsMin: 10, targetRepsMax: 12, targetWeightKg: null }));
    expect(exerciseCollapsedLine(ex, 'kg')).toBe('3 × 10–12 · rest 1:30');
  });

  it('can leave out the rest and mention substitutes', () => {
    const base = exercise('Lat Pulldown', times(3));
    const sub = { id: id(), exerciseId: id(), exerciseName: 'Pull-up', trackingType: 'reps' as const, note: null, sets: [set()] };
    expect(exerciseCollapsedLine({ ...base, substitutes: [sub] }, 'kg', { rest: false })).toBe('3 × 8 @ 60 kg · 1 substitute');
  });
});

describe('blockCollapsedSummary', () => {
  it('names a straight exercise and gives its line', () => {
    const b = block('straight', [exercise('Bench Press', times(4))]);
    expect(blockCollapsedSummary(b, 'kg')).toEqual({ title: 'Bench Press', line: '4 × 8 @ 60 kg · rest 1:30', parts: [] });
  });

  it('gives a superset its rounds and the rest after each round, and one line per exercise', () => {
    const a = exercise('Bench Press', times(3, { restSeconds: 0 }));
    const c = exercise('Row', times(3, { targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 40, restSeconds: 90 }));
    const b = block('superset', [a, c]);
    expect(blockCollapsedSummary(b, 'kg')).toEqual({
      title: 'Superset / circuit',
      line: '3 rounds · rest 1:30',
      parts: [
        { key: a.id, name: 'Bench Press', line: '3 × 8 @ 60 kg' },
        { key: c.id, name: 'Row', line: '3 × 10 @ 40 kg' },
      ],
    });
  });

  it('reads an uneven superset as sets per exercise', () => {
    const b = block('superset', [exercise('A', times(3, { restSeconds: 0 })), exercise('B', times(2, { restSeconds: 0 }))]);
    expect(blockCollapsedSummary(b, 'kg').line).toBe('3 + 2 sets');
  });

  it('lists the options of a pick-one group', () => {
    const a = exercise('Leg Press', times(3));
    const c = exercise('Hack Squat', times(3));
    expect(blockCollapsedSummary(block('choice', [a, c]), 'kg')).toEqual({
      title: 'Pick one',
      line: '2 options',
      parts: [
        { key: a.id, name: 'Leg Press', line: '3 × 8 @ 60 kg · rest 1:30' },
        { key: c.id, name: 'Hack Squat', line: '3 × 8 @ 60 kg · rest 1:30' },
      ],
    });
  });
});

describe('steppers', () => {
  it('steps reps by one, from empty to 1, never below 1 or above 1000', () => {
    expect(stepReps(8, 1)).toBe(9);
    expect(stepReps(8, -1)).toBe(7);
    expect(stepReps(1, -1)).toBe(1);
    expect(stepReps(null, 1)).toBe(1);
    expect(stepReps(null, -1)).toBeNull();
    expect(stepReps(1000, 1)).toBe(1000);
  });

  it('steps weight by 2.5 kg or 5 lb, onto the step grid', () => {
    expect(weightStep('kg')).toBe(2.5);
    expect(weightStep('lb')).toBe(5);
    expect(stepWeight(60, 1, 'kg')).toBe(62.5);
    expect(stepWeight(60, -1, 'kg')).toBe(57.5);
    expect(stepWeight(61, 1, 'kg')).toBe(62.5);
    expect(stepWeight(61, -1, 'kg')).toBe(60);
    expect(stepWeight(1, -1, 'kg')).toBe(0);
    expect(stepWeight(0, -1, 'kg')).toBe(0);
    expect(stepWeight(null, 1, 'kg')).toBe(2.5);
    expect(stepWeight(null, -1, 'kg')).toBeNull();
    expect(stepWeight(1000, 1, 'kg')).toBe(1000);
  });

  it('keeps pounds whole on the way through kilograms', () => {
    const next = stepWeight(135 * LB, 1, 'lb')!;
    expect(Math.round(next / LB)).toBe(140);
    expect(Math.round(stepWeight(next, -1, 'lb')! / LB)).toBe(135);
    expect(Math.round(stepWeight(132 * LB, 1, 'lb')! / LB)).toBe(135);
  });
});
