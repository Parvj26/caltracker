// Photos queued for sending live in the app's documents folder, not the cache: iOS may empty the cache at any time,
// which would lose a photo that is still waiting for signal. They are deleted once sent or deleted by the person.
import { Directory, File, Paths } from 'expo-file-system';
import type { OutboxPhoto } from './outbox';

function folder(): Directory {
  const dir = new Directory(Paths.document, 'message-outbox');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Copies a photo's files (from the cache) into the documents folder and returns the photo pointing at the copies. */
export async function persistPhoto(p: OutboxPhoto): Promise<OutboxPhoto> {
  const dir = folder();
  const full = new File(dir, `${p.id}.${p.ext}`);
  const thumb = new File(dir, `${p.id}-thumb.${p.ext}`);
  await new File(p.fullUri).copy(full);
  await new File(p.thumbUri).copy(thumb);
  return { ...p, fullUri: full.uri, thumbUri: thumb.uri };
}

/** Removes a photo's files. Never throws (a file already gone is fine). */
export function deletePhotoFiles(photos: OutboxPhoto[]): void {
  for (const p of photos) {
    for (const uri of [p.fullUri, p.thumbUri]) {
      try {
        const f = new File(uri);
        if (f.exists) f.delete();
      } catch {
        // already gone
      }
    }
  }
}
