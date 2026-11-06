import type { SupabaseClient } from '@supabase/supabase-js';
import { EXERCISE_INDEX_COLUMNS, exerciseIndexRowFromDb, type Database, type ExerciseIndexRow } from '@caltracker/shared';

export type LoadedExerciseIndex = { index: ExerciseIndexRow[]; favourites: string[]; recent: string[] };

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request

// A backstop only: changes the app makes itself call invalidateExerciseIndex().
export const CACHE_MS = 60 * 1000;
let cache: { at: number; userId: string | null; value: Promise<LoadedExerciseIndex> } | null = null;

/** Forget the cached index (after a custom exercise or a workout changes). */
export function invalidateExerciseIndex(): void {
  cache = null;
}

/** Like `fetchExerciseIndex`, but reuses a result for the same user younger than a minute so dialogs don't refetch. */
export async function loadExerciseIndex(supabase: SupabaseClient<Database>): Promise<LoadedExerciseIndex> {
  // getSession reads the stored session (no network call).
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id ?? null;
  if (cache && cache.userId === userId && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = fetchExerciseIndex(supabase);
  const entry = { at: Date.now(), userId, value };
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
      .select(EXERCISE_INDEX_COLUMNS)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load exercises: ${error.message}`);
    for (const e of data) index.push(exerciseIndexRowFromDb(e));
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
