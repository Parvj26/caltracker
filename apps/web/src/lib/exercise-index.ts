import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ExerciseIndexRow } from '@caltracker/shared';

export type LoadedExerciseIndex = { index: ExerciseIndexRow[]; favourites: string[]; recent: string[] };

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; value: Promise<LoadedExerciseIndex> } | null = null;

/** Like `fetchExerciseIndex`, but reuses a result younger than 5 minutes so each dialog open doesn't refetch. */
export function loadExerciseIndex(supabase: SupabaseClient<Database>): Promise<LoadedExerciseIndex> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = fetchExerciseIndex(supabase);
  const entry = { at: Date.now(), value };
  cache = entry;
  // A failed load must not be remembered.
  value.catch(() => {
    if (cache === entry) cache = null;
  });
  return value;
}

/** Keep the cached favourites in step with a star the coach just set. */
export function rememberFavourite(id: string, on: boolean): void {
  const current = cache;
  if (!current) return;
  current.value = current.value.then((v) => ({
    ...v,
    favourites: on ? [...new Set([...v.favourites, id])] : v.favourites.filter((f) => f !== id),
  }));
}

/** Built-in exercises plus this workspace's own (through RLS), the coach's favourites and their 20 most recent. */
async function fetchExerciseIndex(supabase: SupabaseClient<Database>): Promise<LoadedExerciseIndex> {
  const index: ExerciseIndexRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('exercises')
      .select('id, name, primary_muscles, secondary_muscles, equipment, category, tracking_type, source, image_paths')
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load exercises: ${error.message}`);
    for (const e of data) {
      index.push({
        id: e.id,
        name: e.name,
        primaryMuscles: e.primary_muscles,
        secondaryMuscles: e.secondary_muscles,
        equipment: e.equipment,
        category: e.category,
        trackingType: e.tracking_type,
        source: e.source === 'custom' ? 'custom' : 'builtin',
        imagePath: e.image_paths[0] ?? null,
      });
    }
    if (data.length < PAGE) break;
  }

  const [fav, rec] = await Promise.all([
    supabase.from('exercise_favorites').select('exercise_id'),
    supabase.rpc('recent_exercises_for_coach', { p_limit: 20 }),
  ]);
  if (fav.error) throw new Error(`Could not load favourites: ${fav.error.message}`);
  if (rec.error) throw new Error(`Could not load recent exercises: ${rec.error.message}`);
  return {
    index,
    favourites: fav.data.map((r) => r.exercise_id),
    recent: rec.data.map((r) => r.exercise_id),
  };
}

/** Public URL of a stored exercise photo. */
export function exerciseImageUrl(supabase: SupabaseClient<Database>, path: string): string {
  return supabase.storage.from('exercise-images').getPublicUrl(path).data.publicUrl;
}

/** The parts of an exercise that only the preview needs. */
export async function loadExerciseDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ imagePaths: string[]; instructions: string[] }> {
  const { data, error } = await supabase.from('exercises').select('image_paths, instructions').eq('id', id).single();
  if (error) throw new Error(`Could not load exercise: ${error.message}`);
  return { imagePaths: data.image_paths, instructions: data.instructions };
}
