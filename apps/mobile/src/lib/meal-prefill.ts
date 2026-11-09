// Filling Log a meal from something already known: a coach meal ("Log this meal") or a search result ("Use"), and
// the Breakfast / Lunch / Dinner / Snack buttons. Pure, so it is unit tested.
import { MACRO_KEYS, type CoachMeal, type IsoDate, type MealMacros, type MealSearchItem } from '@caltracker/shared';
import type { MealDraft } from './food-logic';

/** A preset fills the name only when it is empty; a typed name is never replaced. */
export function presetName(current: string, preset: string): string {
  return current.trim() === '' ? preset : current;
}

/** Route params for Log a meal prefilled with `item`. A coach meal goes by id (its numbers come from the saved list). */
export function prefillParams(item: MealSearchItem): Record<string, string> {
  if (item.source === 'coach' && item.coachMealId) return { coachMealId: item.coachMealId };
  const out: Record<string, string> = { prefillName: item.name };
  for (const k of MACRO_KEYS) if (item.macros[k] !== null) out[`prefill_${k}`] = String(item.macros[k]);
  if (item.coachMealId) out.prefillCoachMealId = item.coachMealId;
  return out;
}

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string): string | undefined => (typeof p[k] === 'string' ? p[k] : undefined);

/** The new meal's starting values from the route (today and now, no photo). Empty when there is nothing to prefill. */
export function draftFromParams(params: Params, coachMeals: readonly CoachMeal[], today: IsoDate, now: Date): Partial<MealDraft> {
  const at = { day: today, minutes: now.getHours() * 60 + now.getMinutes() };
  const coachId = one(params, 'coachMealId');
  if (coachId) {
    const c = coachMeals.find((m) => m.id === coachId);
    return c ? { ...at, name: c.name, macros: c.macros, coachMealId: c.id } : {};
  }
  const name = one(params, 'prefillName');
  if (!name) return {};
  const macros = { calories: null, protein: null, carbs: null, fat: null } as MealMacros;
  for (const k of MACRO_KEYS) {
    const v = Number(one(params, `prefill_${k}`));
    if (one(params, `prefill_${k}`) !== undefined && Number.isFinite(v)) macros[k] = v;
  }
  return { ...at, name, macros, coachMealId: one(params, 'prefillCoachMealId') ?? null };
}
