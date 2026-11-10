import { describe, expect, it } from 'vitest';
import { trapTabTarget } from './focus-trap';

describe('trapTabTarget', () => {
  it('wraps Tab from the last item to the first', () => {
    expect(trapTabTarget(5, 4, false)).toBe(0);
  });
  it('wraps Shift+Tab from the first item to the last', () => {
    expect(trapTabTarget(5, 0, true)).toBe(4);
  });
  it('pulls focus back in when it is outside the menu', () => {
    expect(trapTabTarget(5, -1, false)).toBe(0);
    expect(trapTabTarget(5, -1, true)).toBe(4);
  });
  it('leaves Tab between inner items to the browser', () => {
    expect(trapTabTarget(5, 2, false)).toBeNull();
    expect(trapTabTarget(5, 2, true)).toBeNull();
  });
  it('does nothing when there is nothing to focus', () => {
    expect(trapTabTarget(0, -1, false)).toBeNull();
  });
});
