// The phone's exercise library wired to the server. Reads go through RLS as the signed-in client: built-in
// exercises plus their own workspace's custom ones.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EXERCISE_INDEX_COLUMNS, exerciseIndexRowFromDb, type ExerciseIndexRow } from '@caltracker/shared';
import { createExerciseIndexLoader, resolveIndexUser, type LoadedExerciseIndex } from './exercise-index';
import { supabase } from './supabase';

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request

async function fetchRows(): Promise<ExerciseIndexRow[]> {
  const rows: ExerciseIndexRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('exercises')
      .select(EXERCISE_INDEX_COLUMNS)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load exercises: ${error.message}`);
    for (const e of data) rows.push(exerciseIndexRowFromDb(e));
    if (data.length < PAGE) break;
  }
  return rows;
}

let current: { userId: string; load: ReturnType<typeof createExerciseIndexLoader> } | null = null;

/**
 * The exercise library for the signed-in user: the saved copy at once, refreshed in the background when over a day
 * old (`onUpdate` hears the result). Works offline, even when the expired session can't be read.
 */
export async function loadExerciseIndexCached(onUpdate?: (next: LoadedExerciseIndex) => void): Promise<LoadedExerciseIndex> {
  const { data } = await supabase.auth.getSession(); // reads the stored session, no network call
  const userId = await resolveIndexUser(AsyncStorage, () => AsyncStorage.getAllKeys(), data.session?.user.id ?? null);
  if (!userId) throw new Error('Not signed in');
  if (current?.userId !== userId) current = { userId, load: createExerciseIndexLoader(AsyncStorage, fetchRows, userId) };
  return current.load(onUpdate);
}

/** The client's most recently logged exercises, newest first. Empty when it can't be loaded (e.g. offline). */
export async function loadRecentExerciseIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('recent_exercises_for_client', { p_limit: 20 });
  if (error) return [];
  return data.map((r) => r.exercise_id);
}
