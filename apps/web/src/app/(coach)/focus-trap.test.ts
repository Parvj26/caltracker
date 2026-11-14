import { describe, expect, it } from 'vitest';
import { cycleTabTarget } from './focus-trap';

describe('cycleTabTarget', () => {
  it('moves to the next or previous item, wrapping round', () => {
    expect(cycleTabTarget(5, 2, false)).toBe(3);
    expect(cycleTabTarget(5, 2, true)).toBe(1);
    expect(cycleTabTarget(5, 4, false)).toBe(0);
    expect(cycleTabTarget(5, 0, true)).toBe(4);
  });
  it('pulls focus back in when it is outside', () => {
    expect(cycleTabTarget(5, -1, false)).toBe(0);
    expect(cycleTabTarget(5, -1, true)).toBe(4);
  });
  it('does nothing when there is nothing to focus', () => {
    expect(cycleTabTarget(0, -1, false)).toBeNull();
  });
});
