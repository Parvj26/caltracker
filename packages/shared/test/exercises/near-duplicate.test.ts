import { describe, expect, it } from 'vitest';
import { compactExerciseName, exerciseNameKey, findNearDuplicate, sameExerciseName } from '../../src/exercises/near-duplicate';

const rows = [
  { id: '1', name: 'Sandbag Carry' },
  { id: '2', name: 'T-Bar Row' },
  { id: '3', name: 'Burpee' },
];

describe('creating an exercise from search', () => {
  it('treats case and spacing as the same name (the server refuses these)', () => {
    expect(exerciseNameKey('  Sandbag   CARRY ')).toBe('sandbag carry');
    expect(sameExerciseName('sandbag carry', 'Sandbag Carry')).toBe(true);
    expect(sameExerciseName('sand bag carry', 'Sandbag Carry')).toBe(false);
  });

  it('finds a near-identical name, ignoring case, spaces, accents and punctuation', () => {
    expect(compactExerciseName('Sand-bag Carry')).toBe('sandbagcarry');
    expect(findNearDuplicate('sand bag carry', rows)?.id).toBe('1');
    expect(findNearDuplicate('t bar row', rows)?.id).toBe('2');
    expect(findNearDuplicate('BURPÉE', rows)?.id).toBe('3');
  });

  it('says nothing for a different name or a blank one', () => {
    expect(findNearDuplicate('Sandbag Clean', rows)).toBeNull();
    expect(findNearDuplicate('Burpees', rows)).toBeNull();
    expect(findNearDuplicate('  ', rows)).toBeNull();
  });
});
