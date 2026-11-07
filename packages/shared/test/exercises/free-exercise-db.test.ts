import { describe, expect, it } from 'vitest';
import { exerciseImageObjectPath, mapFreeExercise, type FreeExercise } from '../../src/exercises/free-exercise-db';

const squat: FreeExercise = {
  id: 'Barbell_Squat',
  name: 'Barbell Squat',
  force: 'push',
  level: 'intermediate',
  mechanic: 'compound',
  equipment: 'barbell',
  primaryMuscles: ['quadriceps'],
  secondaryMuscles: ['glutes', 'hamstrings'],
  instructions: ['Stand under the bar.', 'Squat down.'],
  category: 'strength',
  images: ['Barbell_Squat/0.jpg', 'Barbell_Squat/1.jpg'],
};

const plank: FreeExercise = {
  id: 'Plank',
  name: 'Plank',
  force: 'static',
  level: 'beginner',
  mechanic: null,
  equipment: 'body only',
  primaryMuscles: ['abdominals'],
  secondaryMuscles: [],
  instructions: ['Hold.'],
  category: 'strength',
  images: ['Plank/0.jpg'],
};

describe('mapFreeExercise', () => {
  it('maps a built-in exercise', () => {
    const row = mapFreeExercise(squat, {});
    expect(row.source).toBe('builtin');
    expect(row.workspace_id ?? null).toBeNull();
    expect(row.external_id).toBe('Barbell_Squat');
    expect(row.name).toBe('Barbell Squat');
    expect(row.tracking_type).toBe('weight_reps');
    expect(row.primary_muscles).toEqual(['quadriceps']);
    expect(row.secondary_muscles).toEqual(['glutes', 'hamstrings']);
    expect(row.equipment).toBe('barbell');
    expect(row.category).toBe('strength');
    expect(row.image_paths?.[0]).toMatch(/^free-exercise-db\/Barbell_Squat\//);
    expect(row.image_paths).toEqual([
      'free-exercise-db/Barbell_Squat/0.webp',
      'free-exercise-db/Barbell_Squat/1.webp',
    ]);
  });

  it('lets an override win over inference', () => {
    expect(mapFreeExercise(plank, {}).tracking_type).toBe('reps');
    expect(mapFreeExercise(plank, { Plank: 'time' }).tracking_type).toBe('time');
  });
});

describe('exerciseImageObjectPath', () => {
  it('puts the processed WebP under the free-exercise-db prefix', () => {
    expect(exerciseImageObjectPath('Barbell_Squat/0.jpg')).toBe('free-exercise-db/Barbell_Squat/0.webp');
    expect(exerciseImageObjectPath('Some_Exercise/1.JPEG')).toBe('free-exercise-db/Some_Exercise/1.webp');
    expect(exerciseImageObjectPath('X/0.png')).toBe('free-exercise-db/X/0.webp');
  });

  it('rejects paths that could escape the prefix', () => {
    expect(() => exerciseImageObjectPath('../evil/0.jpg')).toThrow();
    expect(() => exerciseImageObjectPath('/abs/0.jpg')).toThrow();
    expect(() => exerciseImageObjectPath('noext')).toThrow();
  });
});
