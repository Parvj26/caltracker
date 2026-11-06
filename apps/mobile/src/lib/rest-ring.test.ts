import { describe, expect, it } from 'vitest';
import { ringFraction } from './rest-ring';

describe('ringFraction', () => {
  const start = 1_000_000;
  it('is full at the start', () => expect(ringFraction(start + 90_000, 90, start)).toBe(1));
  it('is half at the midpoint', () => expect(ringFraction(start + 90_000, 90, start + 45_000)).toBe(0.5));
  it('is 0 after the end', () => expect(ringFraction(start + 90_000, 90, start + 100_000)).toBe(0));
  it('is 0 when the total is 0', () => expect(ringFraction(start, 0, start)).toBe(0));
  it('never goes above 1 after -15 s', () => expect(ringFraction(start + 75_000, 90, start)).toBeLessThanOrEqual(1));
});
