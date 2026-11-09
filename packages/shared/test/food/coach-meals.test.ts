import { describe, expect, it } from 'vitest';
import { COACH_MEAL_LIMITS, COACH_MEAL_PHOTO_BUCKET, chipMacroLine, coachMealPhotoPaths, coachMealProblems, compactMacroLine } from '../../src/food/coach-meals';

const draft = { name: 'Protein oats', ingredients: '', howTo: '' };

describe('coach meals', () => {
  it('has the database limits', () => {
    expect(COACH_MEAL_LIMITS).toEqual({ name: 40, ingredients: 2000, howTo: 4000 });
    expect(COACH_MEAL_PHOTO_BUCKET).toBe('coach-meal-photos');
  });
  it('explains what is wrong with a draft', () => {
    expect(coachMealProblems(draft)).toEqual([]);
    expect(coachMealProblems({ ...draft, name: '  ' })).toEqual(['Give the meal a name.']);
    expect(coachMealProblems({ ...draft, name: 'x'.repeat(41) })).toEqual(['Keep the name to 40 characters.']);
    expect(coachMealProblems({ ...draft, ingredients: 'x'.repeat(2001) })).toEqual(['Keep the ingredients to 2,000 characters.']);
    expect(coachMealProblems({ ...draft, howTo: 'x'.repeat(4001) })).toEqual(['Keep how to make it to 4,000 characters.']);
  });
  it('builds photo paths', () => {
    expect(coachMealPhotoPaths('w', 'm', 'p', 'webp')).toEqual({ path: 'w/m-p.webp', thumbPath: 'w/m-p-thumb.webp' });
  });
  it('writes compact macro lines', () => {
    expect(compactMacroLine({ calories: 1610, protein: 48, carbs: 62.5, fat: 14 })).toBe('1,610 kcal · 48 P · 62.5 C · 14 F');
    expect(compactMacroLine({ calories: null, protein: 48, carbs: null, fat: 14 })).toBe('48 P · 14 F');
    expect(compactMacroLine({ calories: null, protein: null, carbs: null, fat: null })).toBe('');
    expect(chipMacroLine({ calories: 320, protein: 28, carbs: 40, fat: 5 })).toBe('320 kcal · 28 g P');
    expect(chipMacroLine({ calories: 320, protein: null, carbs: 40, fat: 5 })).toBe('320 kcal');
    expect(chipMacroLine({ calories: null, protein: 28, carbs: null, fat: null })).toBe('28 g P');
  });
});
