import { describe, expect, it } from 'vitest';
import type { CoachMeal, MealSearchItem } from '@caltracker/shared';
import { draftFromParams, prefillParams, presetName } from './meal-prefill';

const c1: CoachMeal = {
  id: 'c1',
  name: 'Protein oats',
  macros: { calories: 450, protein: 35, carbs: 52, fat: 11 },
  ingredients: '',
  howTo: '',
  photo: null,
  updatedAt: 't',
};
const now = new Date(2026, 10, 9, 12, 30);

describe('presetName', () => {
  it('fills an empty name', () => {
    expect(presetName('', 'Lunch')).toBe('Lunch');
    expect(presetName('  ', 'Lunch')).toBe('Lunch');
  });
  it('never replaces a typed name', () => {
    expect(presetName('Chicken wrap', 'Lunch')).toBe('Chicken wrap');
    expect(presetName('Lunch', 'Dinner')).toBe('Lunch');
  });
});

describe('draftFromParams', () => {
  it('prefills from a coach meal: today, now, its name, numbers and link', () => {
    expect(draftFromParams({ coachMealId: 'c1' }, [c1], '2026-11-09', now)).toEqual({
      day: '2026-11-09',
      minutes: 12 * 60 + 30,
      name: 'Protein oats',
      macros: c1.macros,
      coachMealId: 'c1',
    });
  });
  it('falls back to an empty form for a coach meal it does not know', () => {
    expect(draftFromParams({ coachMealId: 'gone' }, [c1], '2026-11-09', now)).toEqual({});
    expect(draftFromParams({}, [c1], '2026-11-09', now)).toEqual({});
  });
  it('round-trips an own meal', () => {
    const item: MealSearchItem = {
      key: 'k',
      source: 'own',
      name: 'Chicken & rice',
      macros: { calories: 610, protein: 48.5, carbs: null, fat: 14 },
      coachMealId: null,
      count: 6,
      lastEatenAt: null,
      lastEatenOn: null,
    };
    expect(draftFromParams(prefillParams(item), [], '2026-11-09', now)).toMatchObject({ name: 'Chicken & rice', macros: item.macros, coachMealId: null });
  });
  it('a coach item becomes just its id', () => {
    expect(prefillParams({ key: 'k', source: 'coach', name: 'Protein oats', macros: c1.macros, coachMealId: 'c1', count: 0, lastEatenAt: null, lastEatenOn: null })).toEqual({
      coachMealId: 'c1',
    });
  });
});
