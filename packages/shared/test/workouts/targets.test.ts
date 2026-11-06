import { describe, expect, it } from 'vitest';
import { TARGET_FIELDS, TRACKING_TYPE_LABELS, formatRest, formatSetTarget, formatSetsSummary } from '../../src/workouts/targets';
import type { WorkoutSetDoc } from '../../src/workouts/schema';

const base: WorkoutSetDoc = {
  id: '11111111-1111-4111-8111-111111111111',
  setType: 'normal',
  targetRepsMin: null,
  targetRepsMax: null,
  targetWeightKg: null,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 0,
  note: null,
};

describe('TARGET_FIELDS and labels', () => {
  it('lists the fields each tracking type uses', () => {
    expect(TARGET_FIELDS).toEqual({
      weight_reps: ['reps', 'weight'],
      reps: ['reps'],
      time: ['duration'],
      distance: ['distance'],
    });
  });
  it('has a label per tracking type', () => {
    expect(TRACKING_TYPE_LABELS).toEqual({
      weight_reps: 'weight and reps',
      reps: 'reps only',
      time: 'time',
      distance: 'distance',
    });
  });
});

describe('formatSetTarget', () => {
  it('shows a rep range in pounds', () => {
    const set = { ...base, targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 61.235 };
    expect(formatSetTarget(set, 'weight_reps', 'lb')).toBe('8–10 reps · 135 lb');
  });
  it('shows a single rep count when min equals max', () => {
    const set = { ...base, targetRepsMin: 8, targetRepsMax: 8, targetWeightKg: 60 };
    expect(formatSetTarget(set, 'weight_reps', 'kg')).toBe('8 reps · 60 kg');
  });
  it('shows reps only', () => {
    expect(formatSetTarget({ ...base, targetRepsMin: 12, targetRepsMax: 12 }, 'reps', 'kg')).toBe('12 reps');
  });
  it('shows a minimum alone as that many reps', () => {
    expect(formatSetTarget({ ...base, targetRepsMin: 8 }, 'reps', 'kg')).toBe('8 reps');
  });
  it('shows duration', () => {
    expect(formatSetTarget({ ...base, targetDurationS: 45 }, 'time', 'kg')).toBe('45 s');
  });
  it('shows distance', () => {
    expect(formatSetTarget({ ...base, targetDistanceM: 5000 }, 'distance', 'kg')).toBe('5 km');
  });
  it('shows To failure', () => {
    expect(formatSetTarget({ ...base, setType: 'drop', toFailure: true }, 'weight_reps', 'kg')).toBe('To failure');
  });
  it('puts the weight before to failure', () => {
    const drop = { ...base, setType: 'drop' as const, toFailure: true, targetWeightKg: 40 };
    expect(formatSetTarget(drop, 'weight_reps', 'kg')).toBe('40 kg × to failure');
    expect(formatSetTarget(drop, 'weight_reps', 'lb')).toBe('88 lb × to failure');
    expect(formatSetTarget(drop, 'reps', 'kg')).toBe('To failure');
  });
  it('shows a dash with no targets', () => {
    expect(formatSetTarget(base, 'weight_reps', 'kg')).toBe('—');
  });
  it('ignores targets that do not apply to the tracking type', () => {
    expect(formatSetTarget({ ...base, targetWeightKg: 20 }, 'reps', 'kg')).toBe('—');
  });
});

describe('formatRest', () => {
  it('formats rest', () => {
    expect(formatRest(90)).toBe('Rest 1:30');
    expect(formatRest(45)).toBe('Rest 45 s');
    expect(formatRest(0)).toBe('');
  });
});

describe('formatSetsSummary', () => {
  const lb = (n: number) => n * 0.45359237;
  const set = (patch: Partial<WorkoutSetDoc>): WorkoutSetDoc => ({ ...base, ...patch });
  const reps = (n: number) => ({ targetRepsMin: n, targetRepsMax: n });

  it('puts the weight first, in the client units, with a count of the sets', () => {
    const sets = [35, 45, 55, 30].map((w, i) => set({ ...reps([12, 12, 10, 5][i]!), targetWeightKg: lb(w) }));
    expect(formatSetsSummary(sets, 'weight_reps', 'lb')).toEqual({
      text: '35 lb × 12, 45 lb × 12, 55 lb × 10, 30 lb × 5',
      count: 4,
    });
  });
  it('keeps a half pound someone typed', () => {
    expect(formatSetsSummary([set({ ...reps(8), targetWeightKg: 46.493 })], 'weight_reps', 'lb').text).toBe(
      '102.5 lb × 8',
    );
  });
  it('shows kilograms and a rep range', () => {
    const sets = [set({ targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 60 }), set({ ...reps(8), targetWeightKg: 62.5 })];
    expect(formatSetsSummary(sets, 'weight_reps', 'kg')).toEqual({ text: '60 kg × 8–10, 62.5 kg × 8', count: 2 });
  });
  it('words a set with no weight, or no reps, as formatSetTarget does', () => {
    const sets = [set(reps(12)), set({ targetWeightKg: 20 }), set({})];
    expect(formatSetsSummary(sets, 'weight_reps', 'kg').text).toBe('12 reps, 20 kg, —');
  });
  it('shows reps-only sets as reps', () => {
    expect(formatSetsSummary([set(reps(10)), set(reps(8))], 'reps', 'lb')).toEqual({ text: '10 reps, 8 reps', count: 2 });
  });
  it('shows timed sets as their duration, ignoring a weight', () => {
    const sets = [set({ targetDurationS: 45, targetWeightKg: 10 }), set({ targetDurationS: 90 })];
    expect(formatSetsSummary(sets, 'time', 'lb')).toEqual({ text: '45 s, 1:30', count: 2 });
  });
  it('shows distance in the client units', () => {
    expect(formatSetsSummary([set({ targetDistanceM: 5000 })], 'distance', 'kg')).toEqual({ text: '5 km', count: 1 });
  });
  it('marks warm-ups with W and counts them', () => {
    const sets = [set({ setType: 'warmup', ...reps(10), targetWeightKg: 20 }), set({ ...reps(8), targetWeightKg: 60 })];
    expect(formatSetsSummary(sets, 'weight_reps', 'kg')).toEqual({ text: 'W 20 kg × 10, 60 kg × 8', count: 2 });
  });
  it('marks drops with an arrow and leaves them out of the count', () => {
    const sets = [
      set({ ...reps(12), targetWeightKg: lb(35) }),
      set({ setType: 'drop', ...reps(8), targetWeightKg: lb(25) }),
      set({ setType: 'drop', toFailure: true }),
      set({ setType: 'drop', toFailure: true, targetWeightKg: lb(15) }),
    ];
    expect(formatSetsSummary(sets, 'weight_reps', 'lb')).toEqual({
      text: '35 lb × 12, ↓ 25 lb × 8, ↓ To failure, ↓ 15 lb × to failure',
      count: 1,
    });
  });
  it('is empty with no sets', () => {
    expect(formatSetsSummary([], 'weight_reps', 'kg')).toEqual({ text: '', count: 0 });
  });
});
