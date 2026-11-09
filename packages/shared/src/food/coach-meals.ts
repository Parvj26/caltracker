// Coach shared meals (docs/superpowers/specs/2026-11-09-food-and-coach-meals-design.md). Limits mirror the
// coach_meals checks in supabase/migrations/20261109000500_coach_meals.sql.

import { group, MACRO_KEYS, MACRO_SHORT, type MealMacros, type MealPhotoExt } from './food';

export const COACH_MEAL_LIMITS = { name: 40, ingredients: 2000, howTo: 4000 } as const;
export const COACH_MEAL_PHOTO_BUCKET = 'coach-meal-photos';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Why a coach meal cannot be saved yet (empty when it can). Macros are checked by parseMacroInput. */
export function coachMealProblems(draft: { name: string; ingredients: string; howTo: string }): string[] {
  const out: string[] = [];
  const name = draft.name.trim();
  if (name === '') out.push('Give the meal a name.');
  else if (name.length > COACH_MEAL_LIMITS.name) out.push(`Keep the name to ${COACH_MEAL_LIMITS.name} characters.`);
  if (draft.ingredients.trim().length > COACH_MEAL_LIMITS.ingredients) {
    out.push(`Keep the ingredients to ${group(COACH_MEAL_LIMITS.ingredients)} characters.`);
  }
  if (draft.howTo.trim().length > COACH_MEAL_LIMITS.howTo) out.push(`Keep how to make it to ${group(COACH_MEAL_LIMITS.howTo)} characters.`);
  return out;
}

/** `{workspace}/{meal}-{photo}.{ext}` and its `-thumb.{ext}` in the coach-meal-photos bucket (the database checks this). */
export function coachMealPhotoPaths(workspaceId: string, mealId: string, photoId: string, ext: MealPhotoExt): { path: string; thumbPath: string } {
  const base = `${workspaceId}/${mealId}-${photoId}`;
  return { path: `${base}.${ext}`, thumbPath: `${base}-thumb.${ext}` };
}

/** "610 kcal · 48 P · 62 C · 14 F": only the macros entered. Empty when none were. */
export function compactMacroLine(m: MealMacros): string {
  return MACRO_KEYS.filter((k) => m[k] !== null)
    .map((k) => (k === 'calories' ? `${group(Math.round(m[k]!))} kcal` : `${group(round1(m[k]!))} ${MACRO_SHORT[k]}`))
    .join(' · ');
}

/** "320 kcal · 28 g P": calories and protein, for chips and tiles. */
export function chipMacroLine(m: MealMacros): string {
  const parts: string[] = [];
  if (m.calories !== null) parts.push(`${group(Math.round(m.calories))} kcal`);
  if (m.protein !== null) parts.push(`${group(round1(m.protein))} g P`);
  return parts.join(' · ');
}
