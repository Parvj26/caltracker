import { describe, expect, it } from 'vitest';
import { matchExercises, normaliseExerciseName, validateAliases, type AliasTable, type SourceExercise } from './exercise-image-match';

const empty: AliasTable = { aliases: {}, aliasNotes: {}, rejected: [] };

describe('normaliseExerciseName', () => {
  it('lower-cases, drops punctuation and expands shorthands', () => {
    expect(normaliseExerciseName('DB Bench Press')).toBe('dumbbell bench press');
    expect(normaliseExerciseName('Dumbbell Bench-Press')).toBe('dumbbell bench press');
    expect(normaliseExerciseName('KB Swing')).toBe(normaliseExerciseName('Kettlebells Swing'));
    expect(normaliseExerciseName('Sit Up & Throw')).toBe('situp and throw');
  });

  it('treats plurals and joined words as the same', () => {
    expect(normaliseExerciseName('Pullups')).toBe('pullup');
    expect(normaliseExerciseName('Pull-Up')).toBe('pullup');
    expect(normaliseExerciseName('Crunches')).toBe('crunch');
    expect(normaliseExerciseName('Dumbbell Lunges')).toBe('dumbbell lunge');
    expect(normaliseExerciseName('Incline Dumbbell Flyes')).toBe('incline dumbbell fly');
    expect(normaliseExerciseName('Barbell Press')).toBe('barbell press');
    expect(normaliseExerciseName('Hip Abductors')).toBe('hip abductor');
  });

  it('keeps different equipment different', () => {
    expect(normaliseExerciseName('Barbell Walking Lunge')).not.toBe(normaliseExerciseName('Dumbbell Walking Lunge'));
  });
});

const sources: SourceExercise[] = [
  { id: 'Pullups', name: 'Pullups', images: ['Pullups/0.jpg'] },
  { id: 'Dumbbell_Lunges', name: 'Dumbbell Lunges', images: ['Dumbbell_Lunges/0.jpg'] },
  { id: 'Kettlebell_Halo', name: 'Kettlebell Halo', images: [] },
  { id: 'Barbell_Walking_Lunge', name: 'Barbell Walking Lunge', images: ['Barbell_Walking_Lunge/0.jpg'] },
  { id: 'Twin_A', name: 'Twin Move', images: ['Twin_A/0.jpg'] },
  { id: 'Twin_B', name: 'Twin Moves', images: ['Twin_B/0.jpg'] },
];

describe('matchExercises', () => {
  it('uses an exercise’s own pictures first', () => {
    const r = matchExercises([{ id: 'Pullups', name: 'Pullups' }], sources, empty);
    expect(r.matches.Pullups).toEqual({ kind: 'own', sourceId: 'Pullups', images: ['Pullups/0.jpg'] });
  });

  it('matches an identical normalised name', () => {
    const r = matchExercises([{ id: 'x:lunge', name: 'DB Lunge' }], sources, empty);
    expect(r.matches['x:lunge']).toEqual({ kind: 'exact', sourceId: 'Dumbbell_Lunges', images: ['Dumbbell_Lunges/0.jpg'] });
  });

  it('never guesses: a similar name with other equipment stays unmatched', () => {
    const r = matchExercises([{ id: 'x:walk', name: 'Dumbbell Walking Lunge' }], sources, empty);
    expect(r.matches['x:walk']).toBeUndefined();
    expect(r.unmatched).toEqual([{ id: 'x:walk', name: 'Dumbbell Walking Lunge', reason: 'no-match', candidates: [] }]);
  });

  it('leaves an exercise without pictures unmatched rather than borrowing', () => {
    const r = matchExercises([{ id: 'Kettlebell_Halo', name: 'Kettlebell Halo' }], sources, empty);
    expect(r.unmatched.map((u) => u.id)).toEqual(['Kettlebell_Halo']);
  });

  it('reports two equally good candidates as ambiguous and uses neither', () => {
    const r = matchExercises([{ id: 'x:twin', name: 'Twin Move' }], sources, empty);
    expect(r.unmatched[0]).toMatchObject({ reason: 'ambiguous', candidates: ['Twin_A', 'Twin_B'] });
  });

  it('uses the hand-checked alias table', () => {
    const table: AliasTable = { aliases: { 'x:walk': 'Barbell_Walking_Lunge' }, aliasNotes: { 'x:walk': 'checked' }, rejected: [] };
    const r = matchExercises([{ id: 'x:walk', name: 'Walk' }], sources, table);
    expect(r.matches['x:walk']).toMatchObject({ kind: 'alias', sourceId: 'Barbell_Walking_Lunge' });
  });
});

describe('validateAliases', () => {
  const lib = ['x:a', 'Kettlebell_Halo'];
  it('rejects aliases to unknown or picture-less sources, or to rejected pairs', () => {
    expect(() => validateAliases({ aliases: { 'x:a': 'Nope' }, aliasNotes: { 'x:a': 'n' }, rejected: [] }, lib, sources)).toThrow(/unknown source/);
    expect(() => validateAliases({ aliases: { 'x:a': 'Kettlebell_Halo' }, aliasNotes: { 'x:a': 'n' }, rejected: [] }, lib, sources)).toThrow(/no pictures/);
    expect(() => validateAliases({ aliases: { 'x:zzz': 'Pullups' }, aliasNotes: { 'x:zzz': 'n' }, rejected: [] }, lib, sources)).toThrow(/unknown library/);
    expect(() =>
      validateAliases({ aliases: { 'x:a': 'Pullups' }, aliasNotes: { 'x:a': 'n' }, rejected: [{ library: 'x:a', source: 'Pullups', reason: 'no' }] }, lib, sources),
    ).toThrow(/rejected/);
    expect(() => validateAliases({ aliases: {}, aliasNotes: {}, rejected: [{ library: 'x:a', source: 'Pullups', reason: ' ' }] }, lib, sources)).toThrow(
      /reason/,
    );
  });
});
