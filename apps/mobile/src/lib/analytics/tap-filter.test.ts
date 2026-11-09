import { describe, expect, it } from 'vitest';
import { isTap } from './tap-filter';

describe('isTap', () => {
  it('counts a touch that barely moved', () => {
    expect(isTap({ x: 100, y: 100 }, { x: 104, y: 103 })).toBe(true);
  });
  it('does not count scrolls or swipes', () => {
    expect(isTap({ x: 100, y: 100 }, { x: 100, y: 140 })).toBe(false);
    expect(isTap({ x: 100, y: 100 }, { x: 115, y: 100 })).toBe(false);
  });
});
