import { describe, expect, it } from 'vitest';
import { shrinkWarning } from './shrink-warning';

describe('shrinkWarning', () => {
  it('names the range of weeks being cut and how many workouts go', () => {
    expect(shrinkWarning(6, 4, 3)).toBe("Weeks 5–6 have 3 workouts. They'll be removed from this program.");
  });

  it('speaks of one week and one workout in the singular', () => {
    expect(shrinkWarning(2, 1, 1)).toBe("Week 2 has 1 workout. It'll be removed from this program.");
    expect(shrinkWarning(6, 4, 1)).toBe("Weeks 5–6 have 1 workout. It'll be removed from this program.");
    expect(shrinkWarning(3, 2, 2)).toBe("Week 3 has 2 workouts. They'll be removed from this program.");
  });
});
