import { describe, expect, it } from 'vitest';
import { TRACKING_TYPES, inferTrackingType } from '../../src/exercises/tracking';

describe('inferTrackingType', () => {
  it.each([
    [{ category: 'cardio', equipment: 'machine' }, 'distance'],
    [{ category: 'stretching', equipment: null }, 'time'],
    [{ category: 'strength', equipment: 'body only' }, 'reps'],
    [{ category: 'strength', equipment: null }, 'reps'],
    [{ category: 'strength', equipment: 'barbell' }, 'weight_reps'],
  ] as const)('%j -> %s', (input, expected) => {
    expect(inferTrackingType(input)).toBe(expected);
  });
});

describe('TRACKING_TYPES', () => {
  it('lists every tracking type, including weight and time for loaded carries and the workout-only measurements', () => {
    expect(TRACKING_TYPES).toEqual(['weight_reps', 'reps', 'time', 'distance', 'weight_time', 'weight', 'reps_time', 'weight_reps_time']);
  });
});
