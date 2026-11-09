// Server reads for the coach's shared meals (docs/superpowers/specs/2026-11-09-food-and-coach-meals-design.md).
import { COACH_MEAL_PHOTO_BUCKET, type CoachMeal } from '@caltracker/shared';
import { createServerSupabase } from '@/lib/supabase/server';

export type ListedCoachMeal = CoachMeal & { logged: number; thumbUrl: string | null; photoUrl: string | null };

const SIGNED_FOR_S = 3600;
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/**
 * The workspace's live shared meals, newest edited first, each with how often clients logged it (any client, current
 * or past) and short-lived links to its photo. RLS lets only the coach read removed ones, and they are left out.
 */
export async function listCoachMeals(workspaceId: string): Promise<ListedCoachMeal[]> {
  const supabase = await createServerSupabase();
  const [meals, counts] = await Promise.all([
    supabase
      .from('coach_meals')
      .select('id, name, calories, protein_g, carbs_g, fat_g, ingredients, how_to, photo_path, photo_thumb_path, photo_width, photo_height, updated_at')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    supabase.rpc('coach_meal_log_counts', { p_workspace_id: workspaceId }),
  ]);
  if (meals.error) throw new Error(`Could not load meals: ${meals.error.message}`);
  // A failed count only hides the "logged N×" numbers.
  const logged = new Map((counts.data ?? []).map((c) => [c.coach_meal_id, Number(c.logged)]));

  const paths = meals.data.flatMap((m) => [m.photo_path, m.photo_thumb_path].filter((p): p is string => p !== null));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(COACH_MEAL_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_FOR_S);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }

  return meals.data.map((m) => ({
    id: m.id,
    name: m.name,
    macros: { calories: num(m.calories), protein: num(m.protein_g), carbs: num(m.carbs_g), fat: num(m.fat_g) },
    ingredients: m.ingredients,
    howTo: m.how_to,
    photo:
      m.photo_path && m.photo_thumb_path
        ? { path: m.photo_path, thumbPath: m.photo_thumb_path, width: m.photo_width ?? 0, height: m.photo_height ?? 0 }
        : null,
    updatedAt: m.updated_at,
    logged: logged.get(m.id) ?? 0,
    thumbUrl: m.photo_thumb_path ? (urls[m.photo_thumb_path] ?? null) : null,
    photoUrl: m.photo_path ? (urls[m.photo_path] ?? null) : null,
  }));
}
