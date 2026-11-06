// Photos queued for sending live in the app's documents folder, not the cache: iOS may empty the cache at any time,
// which would lose a photo that is still waiting for signal. They are deleted once sent or deleted by the person.
//
// The outbox stores bare file NAMES for these copies, never absolute paths: the app's container path can change
// (an app update or a restore moves it), so the full path is rebuilt from the documents folder whenever it is read.
import { Directory, File, Paths } from 'expo-file-system';
import type { OutboxPhoto } from './outbox';

function folder(): Directory {
  const dir = new Directory(Paths.document, 'message-outbox');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** A stored value is either a bare name (our copy) or a full file:// URI (a cache file we could not copy). */
export function isBareName(value: string): boolean {
  return !value.includes('/');
}

/** The file a stored photo value points at, rebuilt from the documents folder when it is a bare name. */
export function photoUri(value: string): string {
  return isBareName(value) ? new File(folder(), value).uri : value;
}

/** Copies a photo's files (from the cache) into the documents folder and returns the photo holding the file names. */
export async function persistPhoto(p: OutboxPhoto): Promise<OutboxPhoto> {
  const dir = folder();
  const fullName = `${p.id}.${p.ext}`;
  const thumbName = `${p.id}-thumb.${p.ext}`;
  await new File(p.fullUri).copy(new File(dir, fullName));
  await new File(p.thumbUri).copy(new File(dir, thumbName));
  return { ...p, fullUri: fullName, thumbUri: thumbName };
}

/** Removes a photo's files. Never throws (a file already gone is fine). */
export function deletePhotoFiles(photos: OutboxPhoto[]): void {
  for (const p of photos) {
    for (const value of [p.fullUri, p.thumbUri]) {
      try {
        const f = new File(photoUri(value));
        if (f.exists) f.delete();
      } catch {
        // already gone
      }
    }
  }
}
