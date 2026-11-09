import { describe, expect, it } from 'vitest';
import { toCoachMeal, toHistoryMeal } from './coach-meals-map';

describe('coach meal rows', () => {
  it('maps a row with a photo', () => {
    expect(
      toCoachMeal({
        id: 'c1', name: 'Protein oats', calories: 450, protein_g: '35.0' as unknown as number, carbs_g: 52, fat_g: null,
        ingredients: '60 g oats', how_to: '', photo_path: 'w/c1-p.webp', photo_thumb_path: 'w/c1-p-thumb.webp',
        photo_width: 1600, photo_height: 1200, updated_at: '2026-11-09T00:00:00Z',
      }),
    ).toEqual({
      id: 'c1', name: 'Protein oats', macros: { calories: 450, protein: 35, carbs: 52, fat: null }, ingredients: '60 g oats', howTo: '',
      photo: { path: 'w/c1-p.webp', thumbPath: 'w/c1-p-thumb.webp', width: 1600, height: 1200 }, updatedAt: '2026-11-09T00:00:00Z',
    });
  });
  it('maps a row without a photo', () => {
    expect(
      toCoachMeal({ id: 'c', name: 'x', calories: null, protein_g: null, carbs_g: null, fat_g: null, ingredients: '', how_to: '', photo_path: null, photo_thumb_path: null, photo_width: null, photo_height: null, updated_at: 't' }).photo,
    ).toBeNull();
  });
  it('maps a history row', () => {
    expect(
      toHistoryMeal({ id: 'm', eaten_on: '2026-11-08', eaten_at: 't', name: null, calories: 300, protein_g: null, carbs_g: null, fat_g: null, photo_path: 'p', coach_meal_id: 'c1' }),
    ).toEqual({ id: 'm', eatenOn: '2026-11-08', eatenAt: 't', name: null, macros: { calories: 300, protein: null, carbs: null, fat: null }, hasPhoto: true, coachMealId: 'c1' });
  });
});
