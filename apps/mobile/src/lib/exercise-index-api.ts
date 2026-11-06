// The phone's exercise library wired to the server. Reads go through RLS as the signed-in client: built-in
// exercises plus their own workspace's custom ones.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { createExerciseIndexLoader, type LoadedExerciseIndex } from './exercise-index';
import { supabase } from './supabase';

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request

async function fetchRows(): Promise<ExerciseIndexRow[]> {
  const rows: ExerciseIndexRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('exercises')
      .select('id, name, primary_muscles, secondary_muscles, equipment, category, tracking_type, source, image_paths')
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load exercises: ${error.message}`);
    for (const e of data) {
      rows.push({
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
  return rows;
}

let current: { userId: string; load: () => Promise<LoadedExerciseIndex> } | null = null;

/** The exercise library for the signed-in user: from the phone when fresh or offline, else fetched and saved. */
export async function loadExerciseIndexCached(): Promise<LoadedExerciseIndex> {
  const { data } = await supabase.auth.getSession(); // reads the stored session, no network call
  const userId = data.session?.user.id;
  if (!userId) throw new Error('Not signed in');
  if (current?.userId !== userId) current = { userId, load: createExerciseIndexLoader(AsyncStorage, fetchRows, userId) };
  return current.load();
}

/** The client's most recently logged exercises, newest first. Empty when it can't be loaded (e.g. offline). */
export async function loadRecentExerciseIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('recent_exercises_for_client', { p_limit: 20 });
  if (error) return [];
  return data.map((r) => r.exercise_id);
}
