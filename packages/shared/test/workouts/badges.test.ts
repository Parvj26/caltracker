import { describe, expect, it } from 'vitest';
import { blockBadges, supersetLetter } from '../../src/workouts/badges';

const b = (kind: 'straight' | 'superset' | 'choice', exercises = kind === 'straight' ? 1 : 2) => ({ kind, exercises: Array.from({ length: exercises }, () => ({})) });

describe('supersetLetter', () => {
  it('goes A to Z, then AA, AB…', () => {
    expect(supersetLetter(0)).toBe('A');
    expect(supersetLetter(25)).toBe('Z');
    expect(supersetLetter(26)).toBe('AA');
    expect(supersetLetter(29)).toBe('AD');
  });
});

describe('blockBadges', () => {
  it('numbers every block as one step and letters each superset (A1, A2)', () => {
    expect(blockBadges([b('straight'), b('superset'), b('straight')])).toEqual([['1'], ['A1', 'A2'], ['3']]);
  });

  it('keeps counting after a superset that comes first (no restart at 1)', () => {
    expect(blockBadges([b('superset'), b('straight'), b('straight')])).toEqual([['A1', 'A2'], ['2'], ['3']]);
  });

  it('letters supersets in their own order, as the client app does', () => {
    expect(blockBadges([b('superset', 3), b('choice'), b('superset')])).toEqual([['A1', 'A2', 'A3'], ['2'], ['B1', 'B2']]);
  });

  it('gives a pick-one group one badge however many options it has', () => {
    expect(blockBadges([b('choice', 4)])).toEqual([['1']]);
  });

  it('is empty for an empty workout', () => {
    expect(blockBadges([])).toEqual([]);
  });
});
