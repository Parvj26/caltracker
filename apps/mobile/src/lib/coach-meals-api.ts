// The coach's shared meals for the phone. RLS shows a current client only the live ones of their workspace.
import { COACH_MEAL_PHOTO_BUCKET, type CoachMeal } from '@caltracker/shared';
import { COACH_MEAL_COLUMNS, toCoachMeal } from './coach-meals-map';
import { supabase } from './supabase';

const SIGNED_URL_SECONDS = 3600;

export async function fetchCoachMeals(workspaceId: string): Promise<CoachMeal[]> {
  const { data, error } = await supabase
    .from('coach_meals')
    .select(COACH_MEAL_COLUMNS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('name');
  if (error) throw new Error("Couldn't load your coach's meals.");
  return data.map(toCoachMeal);
}

/** Short-lived links to coach meal photos, by path. Missing ones are left out (a colour tile shows). */
export async function coachMealPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(COACH_MEAL_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}
