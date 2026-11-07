import { describe, expect, it } from 'vitest';
import { viewFromCookie } from './view-cookie';

describe('viewFromCookie', () => {
  it("reads this coach's view", () => {
    expect(viewFromCookie('c1:4w', 'c1')).toBe('4w');
    expect(viewFromCookie('c1:month', 'c1')).toBe('month');
  });
  it("ignores another coach's view, an unknown view and a missing cookie", () => {
    expect(viewFromCookie('c2:4w', 'c1')).toBeNull();
    expect(viewFromCookie('c1:3w', 'c1')).toBeNull();
    expect(viewFromCookie('4w', 'c1')).toBeNull();
    expect(viewFromCookie(undefined, 'c1')).toBeNull();
  });
});
