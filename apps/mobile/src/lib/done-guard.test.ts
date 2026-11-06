import { describe, expect, it } from 'vitest';
import { REPEAT_MS, ignoreDone, ignoreTick } from './done-guard';

describe('ignoreDone', () => {
  it('lets the first Done through', () => {
    expect(ignoreDone(null, 'a', 1000)).toBe(false);
  });

  it('ignores a second tap that lands on the next step straight away (drop, A2, next set)', () => {
    expect(ignoreDone({ setId: 'a', at: 1000 }, 'b', 1000 + REPEAT_MS - 1)).toBe(true);
  });

  it('ignores Done while the screen still shows the set just completed', () => {
    expect(ignoreDone({ setId: 'a', at: 1000 }, 'a', 1000 + 5000)).toBe(true);
  });

  it('lets Done through on the next step once the moment has passed', () => {
    expect(ignoreDone({ setId: 'a', at: 1000 }, 'b', 1000 + REPEAT_MS)).toBe(false);
  });
});

describe('ignoreTick', () => {
  it('ignores a second tap on the same row within the moment, not another row or later', () => {
    const last = { setId: 'a', at: 1000 };
    expect(ignoreTick(null, 'a', 1000)).toBe(false);
    expect(ignoreTick(last, 'a', 1000 + REPEAT_MS - 1)).toBe(true);
    expect(ignoreTick(last, 'b', 1001)).toBe(false);
    expect(ignoreTick(last, 'a', 1000 + REPEAT_MS)).toBe(false);
  });
});
