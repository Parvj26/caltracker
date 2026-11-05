import { describe, expect, it } from 'vitest';
import { groupDropSets, setLabels } from '../../src/workouts/drop-sets';
import type { SetType } from '../../src/workouts/schema';

const s = (setType: SetType, n = 0) => ({ setType, n });

describe('groupDropSets', () => {
  it('attaches drops to the preceding non-drop set', () => {
    const [a, b, c, d, e] = [s('normal', 1), s('drop', 2), s('drop', 3), s('normal', 4), s('drop', 5)];
    const groups = groupDropSets([a, b, c, d, e]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ set: a, drops: [b, c] });
    expect(groups[1]).toEqual({ set: d, drops: [e] });
  });

  it('returns an empty list for no sets', () => {
    expect(groupDropSets([])).toEqual([]);
  });

  it('throws on a leading drop', () => {
    expect(() => groupDropSets([s('drop'), s('normal')])).toThrow('A drop set must follow a normal or warm-up set.');
  });

  it('lets a warm-up carry drops', () => {
    expect(groupDropSets([s('warmup'), s('drop')])[0]?.drops).toHaveLength(1);
  });
});

describe('setLabels', () => {
  it('labels warm-ups W, numbers normal sets and marks drops', () => {
    expect(setLabels([s('warmup'), s('normal'), s('normal'), s('drop'), s('normal')])).toEqual([
      'W',
      '1',
      '2',
      '↳',
      '3',
    ]);
  });
});
