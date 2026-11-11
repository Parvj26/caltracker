import { describe, expect, it } from 'vitest';
import { mealFormDirty, type MealFormSnapshot } from './form-dirty';

const base: MealFormSnapshot = {
  name: 'Chili',
  macroText: { calories: '490', protein: '45', carbs: '', fat: '14' },
  ingredients: 'Beans',
  howTo: '',
  photoPath: 'ws/meal-1.webp',
  newFile: false,
};

describe('mealFormDirty', () => {
  it('is clean when nothing changed', () => {
    expect(mealFormDirty(base, { ...base, macroText: { ...base.macroText } })).toBe(false);
  });
  it('ignores spaces added around text', () => {
    expect(mealFormDirty(base, { ...base, name: ' Chili  ', ingredients: 'Beans\n' })).toBe(false);
  });
  it.each<[string, Partial<MealFormSnapshot>]>([
    ['the name', { name: 'Chilli' }],
    ['a macro', { macroText: { ...base.macroText, carbs: '38' } }],
    ['the ingredients', { ingredients: 'Beans, rice' }],
    ['how to make it', { howTo: 'Simmer' }],
    ['a removed photo', { photoPath: null }],
    ['a newly picked photo', { newFile: true }],
  ])('is dirty after changing %s', (_, change) => {
    expect(mealFormDirty(base, { ...base, ...change })).toBe(true);
  });
});
