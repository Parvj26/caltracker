// Rows from the server as the phone keeps them: the coach's shared meals and the client's meal history. Pure, so the
// mapping is unit tested without a Supabase client.
import type { CoachMeal, Database, HistoryMeal } from '@caltracker/shared';

type CoachMealRow = Database['public']['Tables']['coach_meals']['Row'];
type MealRow = Database['public']['Tables']['meals']['Row'];

export const COACH_MEAL_COLUMNS =
  'id, name, calories, protein_g, carbs_g, fat_g, ingredients, how_to, photo_path, photo_thumb_path, photo_width, photo_height, updated_at';
export const HISTORY_COLUMNS = 'id, eaten_on, eaten_at, name, calories, protein_g, carbs_g, fat_g, photo_path, coach_meal_id';

// numeric columns can arrive as strings
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export function toCoachMeal(
  r: Pick<CoachMealRow, 'id' | 'name' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'ingredients' | 'how_to' | 'photo_path' | 'photo_thumb_path' | 'photo_width' | 'photo_height' | 'updated_at'>,
): CoachMeal {
  return {
    id: r.id,
    name: r.name,
    macros: { calories: num(r.calories), protein: num(r.protein_g), carbs: num(r.carbs_g), fat: num(r.fat_g) },
    ingredients: r.ingredients,
    howTo: r.how_to,
    photo:
      r.photo_path && r.photo_thumb_path
        ? { path: r.photo_path, thumbPath: r.photo_thumb_path, width: r.photo_width ?? 0, height: r.photo_height ?? 0 }
        : null,
    updatedAt: r.updated_at,
  };
}

export function toHistoryMeal(
  r: Pick<MealRow, 'id' | 'eaten_on' | 'eaten_at' | 'name' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'photo_path' | 'coach_meal_id'>,
): HistoryMeal {
  return {
    id: r.id,
    eatenOn: r.eaten_on,
    eatenAt: r.eaten_at,
    name: r.name,
    macros: { calories: num(r.calories), protein: num(r.protein_g), carbs: num(r.carbs_g), fat: num(r.fat_g) },
    hasPhoto: r.photo_path !== null,
    coachMealId: r.coach_meal_id,
  };
}
