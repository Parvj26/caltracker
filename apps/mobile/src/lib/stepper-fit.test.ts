import { describe, expect, it } from 'vitest';
import { fitStepperFont } from './stepper-fit';

// A weight and a reps stepper side by side on a 390 pt phone leave about 77 pt for the number.
describe('fitStepperFont', () => {
  it('keeps the full size when the number fits', () => {
    expect(fitStepperFont(200, 3, 34)).toBe(34);
  });
  it('shrinks so 102.5, 137 and 12:30 fit a 77 pt box', () => {
    for (const chars of [5, 3, 5]) {
      const size = fitStepperFont(77, chars, 34);
      expect(size * 0.62 * chars).toBeLessThanOrEqual(77);
    }
  });
  it('never goes below a readable floor, and handles an unmeasured box', () => {
    expect(fitStepperFont(20, 8, 34)).toBe(14);
    expect(fitStepperFont(0, 5, 34)).toBe(34);
  });
});
