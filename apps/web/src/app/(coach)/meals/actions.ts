'use server';

import { revalidatePath } from 'next/cache';
import { COACH_MEAL_PHOTO_BUCKET, MACRO_KEYS, codeForMessage, coachMealProblems, parseMacroInput, type MacroKey } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

export type CoachMealInput = {
  /** Made in the browser (the photo's file names include it). */
  id: string;
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  ingredients: string;
  howTo: string;
  /** Already uploaded by the browser, or null for no photo. */
  photo: { path: string; thumbPath: string; width: number; height: number } | null;
  /** Old photo files the meal no longer uses (deleted after it saves, best effort). */
  dropPaths: string[];
};
export type CoachMealOutcome = { ok: true } | ActionFailure;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const isUuid = (s: string) => new RegExp(`^${UUID}$`).test(s);
const COLUMN: Record<MacroKey, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'> = { calories: 'calories', protein: 'protein_g', carbs: 'carbs_g', fat: 'fat_g' };

/** Files of this meal: `{workspace}/{meal}-{photo}.{webp|jpg}` (and the thumbnail). The database checks it again. */
function ownsFile(workspaceId: string, mealId: string, path: string, thumb: boolean): boolean {
  return new RegExp(`^${workspaceId}/${mealId}-${UUID}${thumb ? '-thumb' : ''}\\.(webp|jpg)$`).test(path);
}

/** Creates or updates a shared meal of the coach's workspace. Safe to repeat (the id is made in the browser). */
export async function saveCoachMeal(input: CoachMealInput): Promise<CoachMealOutcome> {
  const { workspaceId } = await requireCoach(); // never trust a client-supplied workspace id
  if (!isUuid(input.id)) return fail('meal_save_failed', 'action:meals.saveCoachMeal');
  const problems = coachMealProblems(input);
  if (problems[0]) return fail(codeForMessage(problems[0], 'meal_details_invalid'), 'action:meals.saveCoachMeal');

  const macros: Partial<Record<'calories' | 'protein_g' | 'carbs_g' | 'fat_g', number | null>> = {};
  for (const k of MACRO_KEYS) {
    const r = parseMacroInput(k, input[k]);
    if ('error' in r) return fail(codeForMessage(r.error, 'meal_details_invalid'), 'action:meals.saveCoachMeal');
    macros[COLUMN[k]] = r.value;
  }

  const p = input.photo;
  if (p) {
    const sizeOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1600;
    const thumbOk = p.thumbPath === p.path.replace(/\.(webp|jpg)$/, '-thumb.$1');
    if (!ownsFile(workspaceId, input.id, p.path, false) || !thumbOk || !sizeOk(p.width) || !sizeOk(p.height)) return fail('meal_photo_failed', 'action:meals.saveCoachMeal');
  }

  const fields = {
    name: input.name.trim(),
    ...macros,
    ingredients: input.ingredients.trim(),
    how_to: input.howTo.trim(),
    photo_path: p?.path ?? null,
    photo_thumb_path: p?.thumbPath ?? null,
    photo_width: p?.width ?? null,
    photo_height: p?.height ?? null,
  };

  const supabase = await createServerSupabase();
  const inserted = await supabase.from('coach_meals').insert({ id: input.id, workspace_id: workspaceId, ...fields });
  if (inserted.error?.code === '23505') {
    const updated = await supabase
      .from('coach_meals')
      .update(fields)
      .eq('id', input.id)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .select('id');
    if (updated.error) return fail('meal_save_failed', 'action:meals.saveCoachMeal');
    if (updated.data.length === 0) return fail('meal_locked', 'action:meals.saveCoachMeal');
  } else if (inserted.error) {
    return fail(inserted.error.code === '23514' ? 'meal_details_invalid' : 'meal_save_failed', 'action:meals.saveCoachMeal');
  }

  // Only this meal's own old files (a forged list can't delete anything else).
  const drop = input.dropPaths.filter((d) => d !== p?.path && d !== p?.thumbPath && (ownsFile(workspaceId, input.id, d, false) || ownsFile(workspaceId, input.id, d, true)));
  if (drop.length > 0) {
    try {
      await supabase.storage.from(COACH_MEAL_PHOTO_BUCKET).remove(drop);
    } catch {
      // best effort: a file left behind is private and harmless
    }
  }
  revalidatePath('/meals');
  return { ok: true };
}

/** Removes a shared meal: clients stop seeing it; meals they already logged from it stay as they are. */
export async function removeCoachMeal(id: string): Promise<CoachMealOutcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return fail('meal_not_found', 'action:meals.removeCoachMeal');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('coach_meals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .select('id');
  if (error) return fail('meal_remove_failed', 'action:meals.removeCoachMeal');
  if (data.length === 0) return fail('meal_not_found', 'action:meals.removeCoachMeal');
  revalidatePath('/meals');
  return { ok: true };
}
