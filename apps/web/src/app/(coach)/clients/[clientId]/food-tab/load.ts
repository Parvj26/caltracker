import type { SupabaseClient } from '@supabase/supabase-js';
import { MEAL_PHOTO_BUCKET, addDays, type Database, type IsoDate, type MacroTargets, type MealMacros } from '@caltracker/shared';

export type CoachMeal = {
  id: string;
  eatenAt: string;
  eatenOn: IsoDate;
  name: string | null;
  note: string;
  macros: MealMacros;
  photo: { full: string; thumb: string | undefined; width: number | undefined; height: number | undefined } | null;
};
export type FoodWeek = { targets: MacroTargets | null; meals: CoachMeal[] };

const SIGNED_FOR_S = 3600;
const num = (v: number | null): number | null => (v === null ? null : Number(v));

/**
 * One week (Monday to Sunday, by the client's own day) of a client's meals, with short-lived links to their photos,
 * and the client's targets. RLS lets only the coach of the workspace read them (a past client's too).
 */
export async function loadFoodWeek(supabase: SupabaseClient<Database>, workspaceId: string, clientId: string, monday: IsoDate): Promise<FoodWeek> {
  const [meals, targets] = await Promise.all([
    supabase
      .from('meals')
      .select('id, eaten_at, eaten_on, name, note, calories, protein_g, carbs_g, fat_g, photo_path, photo_thumb_path, photo_width, photo_height')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .gte('eaten_on', monday)
      .lte('eaten_on', addDays(monday, 6))
      .order('eaten_at'),
    supabase
      .from('nutrition_targets')
      .select('calories, protein_g, carbs_g, fat_g')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .maybeSingle(),
  ]);
  if (meals.error) throw new Error(`Could not load meals: ${meals.error.message}`);
  if (targets.error) throw new Error(`Could not load targets: ${targets.error.message}`);

  const paths = meals.data.flatMap((m) => [m.photo_path, m.photo_thumb_path].filter((p): p is string => p !== null));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(MEAL_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_FOR_S);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }

  return {
    targets: targets.data
      ? { calories: num(targets.data.calories), protein: num(targets.data.protein_g), carbs: num(targets.data.carbs_g), fat: num(targets.data.fat_g) }
      : null,
    meals: meals.data.map((m) => {
      const full = m.photo_path ? urls[m.photo_path] : undefined;
      return {
        id: m.id,
        eatenAt: m.eaten_at,
        eatenOn: m.eaten_on,
        name: m.name,
        note: m.note,
        macros: { calories: num(m.calories), protein: num(m.protein_g), carbs: num(m.carbs_g), fat: num(m.fat_g) },
        photo: full
          ? { full, thumb: m.photo_thumb_path ? urls[m.photo_thumb_path] : undefined, width: m.photo_width ?? undefined, height: m.photo_height ?? undefined }
          : null,
      };
    }),
  };
}
