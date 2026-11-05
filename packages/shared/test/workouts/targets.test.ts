import { describe, expect, it } from 'vitest';
import { TARGET_FIELDS, TRACKING_TYPE_LABELS, formatRest, formatSetTarget } from '../../src/workouts/targets';
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
