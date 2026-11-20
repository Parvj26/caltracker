import { describe, expect, it } from 'vitest';
import { coachHealth, coachWeekLabel } from './coach-health';

describe('coachHealth', () => {
  it('uses Active / Going quiet / Inactive', () => {
    expect(['good', 'quiet', 'inactive', 'unknown'].map((t) => coachHealth(t).label)).toEqual(['Active', 'Going quiet', 'Inactive', 'Inactive']);
  });
});

describe('coachWeekLabel', () => {
  it('counts workouts built and programs assigned', () => {
    expect(coachWeekLabel(1, 0)).toBe('1 built · 0 assigned');
  });
});
