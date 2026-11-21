import { isAlreadyUploaded } from '@caltracker/shared';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { PhotoError, compressPhoto } from '@/lib/image-resize';
import { exercisePhotoPath } from '@/lib/corrective-library';

/** The bucket takes WebP or JPEG up to 5 MB (20261121002000). compressPhoto always gives one of the two. */
export const EXERCISE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** A photo still over the bucket's 5 MB after shrinking (rare: a very detailed picture). */
export class PhotoTooLargeError extends PhotoError {}

/**
 * Prepares a photo for one of the coach's own exercises on the device (upright, at most 1600 px on the long edge) and
 * uploads it to custom/<workspace>/<exercise>/<uuid>.webp|jpg in the exercise-images bucket. Returns its path; the
 * caller then saves it on the exercise with setExercisePhotos (which checks the path on the server).
 *
 * Only the full photo is stored: the bucket's policy allows one file name shape (<uuid>.<ext>), and exercise photos
 * show at most ~300 px wide, so the 1600 px file is the one shown (no separate thumbnail). Over 5 MB (the bucket's
 * limit) it throws PhotoTooLargeError, which the screens show as a friendly message.
 */
export async function uploadExercisePhoto(workspaceId: string, exerciseId: string, file: File): Promise<string> {
  const c = await compressPhoto(file);
  if (c.full.size > EXERCISE_PHOTO_MAX_BYTES) throw new PhotoTooLargeError('That photo is too big.');
  const path = exercisePhotoPath(workspaceId, exerciseId, crypto.randomUUID(), c.ext);
  const supabase = createBrowserSupabase();
  const { error } = await supabase.storage.from('exercise-images').upload(path, c.full, { contentType: c.full.type, upsert: false });
  if (error && !isAlreadyUploaded(error)) {
    // The bucket's own limit (size or type) answers 413 / 415.
    const status = Number((error as { statusCode?: string | number }).statusCode ?? 0);
    if (status === 413 || /exceeded the maximum allowed size|payload too large/i.test(error.message)) throw new PhotoTooLargeError('That photo is too big.');
    throw new PhotoError("Couldn't upload the photo. Please try again.");
  }
  return path;
}

/** Public URL of a stored exercise photo. */
export function exercisePhotoUrl(path: string): string {
  return createBrowserSupabase().storage.from('exercise-images').getPublicUrl(path).data.publicUrl;
}
