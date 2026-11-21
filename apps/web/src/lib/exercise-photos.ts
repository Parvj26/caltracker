import { isAlreadyUploaded } from '@caltracker/shared';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { PhotoError, compressPhoto } from '@/lib/image-resize';
import { exercisePhotoPath } from '@/lib/corrective-library';

/**
 * Prepares a photo for one of the coach's own exercises on the device (upright, at most 1600 px on the long edge) and
 * uploads it to custom/<workspace>/<exercise>/<uuid>.webp|jpg in the exercise-images bucket. Returns its path; the
 * caller then saves it on the exercise with setExercisePhotos (which checks the path on the server).
 *
 * Only the full photo is stored: the bucket's policy allows one file name shape (<uuid>.<ext>), and exercise photos
 * show at most ~300 px wide, so the 1600 px file is the one shown (no separate thumbnail).
 */
export async function uploadExercisePhoto(workspaceId: string, exerciseId: string, file: File): Promise<string> {
  const c = await compressPhoto(file);
  const path = exercisePhotoPath(workspaceId, exerciseId, crypto.randomUUID(), c.ext);
  const supabase = createBrowserSupabase();
  const { error } = await supabase.storage.from('exercise-images').upload(path, c.full, { contentType: c.full.type, upsert: false });
  if (error && !isAlreadyUploaded(error)) throw new PhotoError("Couldn't upload the photo. Please try again.");
  return path;
}

/** Public URL of a stored exercise photo. */
export function exercisePhotoUrl(path: string): string {
  return createBrowserSupabase().storage.from('exercise-images').getPublicUrl(path).data.publicUrl;
}
