import { describe, expect, it } from 'vitest';
import { sectionPlace, sectionRuns } from '../../src/workouts/sections';

const sections = [
  { id: 'w', name: 'Warm-Up' },
  { id: 'c', name: 'Core' },
  { id: 'r', name: 'Resistance Training' },
  { id: 'd', name: 'Cool-down' },
];
const blocks = ['w', 'c', 'r', 'r', 'r', 'd'].map((sectionId) => ({
  sectionId,
}));

describe('sectionRuns', () => {
  it('groups consecutive blocks of the same section', () => {
    const runs = sectionRuns(blocks, sections);
    expect(runs.map((r) => r.blockIndexes)).toEqual([[0], [1], [2, 3, 4], [5]]);
    expect(runs.map((r) => r.section?.name)).toEqual(['Warm-Up', 'Core', 'Resistance Training', 'Cool-down']);
  });

  it('returns one unsectioned run when there are no sections', () => {
    const runs = sectionRuns([{ sectionId: null }, { sectionId: null }, { sectionId: null }], []);
    expect(runs).toEqual([{ section: null, blockIndexes: [0, 1, 2] }]);
  });

  it('returns [] for no blocks', () => {
    expect(sectionRuns([], sections)).toEqual([]);
  });

  it('treats unknown ids as unsectioned', () => {
    expect(sectionRuns([{ sectionId: 'zzz' }, { sectionId: null }], sections)).toEqual([
      { section: null, blockIndexes: [0, 1] },
    ]);
  });
});

describe('sectionPlace', () => {
  it('gives the 1-based place inside the run', () => {
    expect(sectionPlace(blocks, sections, 3)).toEqual({
      name: 'Resistance Training',
      at: 2,
      of: 3,
    });
    expect(sectionPlace(blocks, sections, 0)).toEqual({
      name: 'Warm-Up',
      at: 1,
      of: 1,
    });
  });

  it('is null for an unsectioned block', () => {
    expect(sectionPlace([{ sectionId: null }], sections, 0)).toBeNull();
  });
});
