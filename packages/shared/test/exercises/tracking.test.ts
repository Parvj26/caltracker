import { describe, expect, it } from 'vitest';
import { inferTrackingType } from '../../src/exercises/tracking';

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
