// The phone's exercise-detail cache wired to the server. Reads go through RLS as the signed-in client:
// built-in exercises and their own workspace's custom ones, and their own workspace's pinned demo links.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { createDetailCache, type ExerciseDetail } from './exercise-detail';
import { supabase } from './supabase';

const BUCKET = 'exercise-images';

/** Public URL of an exercise photo (same bucket the coach dashboard shows). Pure: no network call. */
export function exerciseImageUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Starts downloading photos so they are on the phone when the thumbnail or sheet shows. Never throws. */
export function prefetchExerciseImages(paths: readonly string[]): void {
  for (const p of paths) Image.prefetch(exerciseImageUrl(p)).catch(() => undefined);
}

async function fetchRemote(ids: string[]): Promise<ExerciseDetail[]> {
  const [own, pinned] = await Promise.all([
    supabase
      .from('exercises')
      .select('id, name, image_paths, primary_muscles, secondary_muscles, equipment, instructions, youtube_url')
      .in('id', ids),
    supabase.from('exercise_overrides').select('exercise_id, youtube_url').in('exercise_id', ids),
  ]);
  if (own.error) {
    console.warn(`[exercises] details: ${own.error.message}`);
    throw new Error('Could not load exercise details');
  }
  // A missing pinned link only means falling back to the exercise's own link, so it never fails the load.
  const pins = new Map((pinned.data ?? []).map((o) => [o.exercise_id, o.youtube_url]));
  return own.data.map((e) => ({
    id: e.id,
    name: e.name,
    imagePaths: e.image_paths,
    primaryMuscles: e.primary_muscles,
    secondaryMuscles: e.secondary_muscles,
    equipment: e.equipment,
    instructions: e.instructions,
    videoUrl: pins.get(e.id) || e.youtube_url || null,
  }));
}

export const exerciseDetails = createDetailCache(AsyncStorage, fetchRemote);
