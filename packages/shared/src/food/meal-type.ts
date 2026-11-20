// Breakfast, Lunch, Dinner or Snack, worked out from the time a meal was eaten. Nothing is stored: the client app and
// the coach website both call this, so they always agree. Ranges (local clock time, start inclusive, end exclusive):
//   Breakfast 04:00–11:00 · Lunch 11:00–15:00 · Dinner 17:00–22:00 · Snack the rest (15:00–17:00 and 22:00–04:00).
// A meal at 00:30 is a late snack on the calendar day it was eaten (the new day), not part of the evening before.

import { zonedParts } from '../dates/dates';
import { MEAL_NAME_PRESETS, group, kcalFromMacros, type MealMacros } from './food';

export type MealType = (typeof MEAL_NAME_PRESETS)[number];
export const MEAL_TYPES: readonly MealType[] = MEAL_NAME_PRESETS;

const DAY = 24 * 60;

/** The type for a clock time given as minutes after midnight (wrapped into one day). */
export function mealTypeForMinutes(minutes: number): MealType {
  const m = ((Math.floor(minutes) % DAY) + DAY) % DAY;
  if (m >= 4 * 60 && m < 11 * 60) return 'Breakfast';
  if (m >= 11 * 60 && m < 15 * 60) return 'Lunch';
  if (m >= 17 * 60 && m < 22 * 60) return 'Dinner';
  return 'Snack';
}

/** The type for an instant, on the clock of `timeZone` (default: the viewer's). */
export function mealTypeForTime(instant: string | Date, timeZone?: string): MealType {
  const p = zonedParts(instant, timeZone);
  return mealTypeForMinutes(p.hour * 60 + p.minute);
}

/** The time one tap on a meal chip sets (minutes after midnight); each sits inside its own range. */
export const USUAL_MEAL_MINUTES: Record<MealType, number> = { Breakfast: 8 * 60, Lunch: 12 * 60 + 30, Dinner: 19 * 60, Snack: 15 * 60 + 30 };

type Named = { name: string | null; eatenAt: string };

/** What a meal is called on screen: its name, or its type when it has none ("Lunch" instead of "Meal"). */
export function mealTitle(meal: Named, timeZone?: string): string {
  return meal.name?.trim() || mealTypeForTime(meal.eatenAt, timeZone);
}

/** The type shown beside a named meal ("Tuna wrap · Lunch · 12:15 pm"); null when the title already says it. */
export function mealTypeTag(meal: Named, timeZone?: string): MealType | null {
  const name = meal.name?.trim();
  if (!name) return null;
  const type = mealTypeForTime(meal.eatenAt, timeZone);
  return name.toLowerCase() === type.toLowerCase() ? null : type;
}

/** "Protein, carbs and fat add up to 442 kcal." once any of the three is filled; a check, never saved. */
export function macroSumHint(m: MealMacros): string | null {
  const kcal = kcalFromMacros(m);
  return kcal === null ? null : `Protein, carbs and fat add up to ${group(kcal)} kcal.`;
}
