import { describe, expect, it } from 'vitest';
import { REPEAT_MS, ignoreTick } from './done-guard';

describe('ignoreTick', () => {
  it('ignores a second tap on the same row within the moment, not another row or later', () => {
    const last = { setId: 'a', at: 1000 };
    expect(ignoreTick(null, 'a', 1000)).toBe(false);
    expect(ignoreTick(last, 'a', 1000 + REPEAT_MS - 1)).toBe(true);
    expect(ignoreTick(last, 'b', 1001)).toBe(false);
    expect(ignoreTick(last, 'a', 1000 + REPEAT_MS)).toBe(false);
  });
});
