// Shrinks a picked photo on the phone before it is uploaded: at most 1600 px on the long edge plus a 320 px
// thumbnail, both WebP (JPEG if the phone cannot write WebP). Files land in the app cache.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FULL_MAX_EDGE, THUMB_MAX_EDGE, fitWithin, type PhotoExt } from '@caltracker/shared';
import { randomUUID } from 'expo-crypto';
import type { OutboxPhoto } from './outbox';

async function render(uri: string, size: { width: number; height: number }, format: SaveFormat, compress: number) {
  const ref = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  return ref.saveAsync({ format, compress });
}

async function encode(uri: string, size: { width: number; height: number }, quality: number): Promise<{ uri: string; ext: PhotoExt }> {
  try {
    const webp = await render(uri, size, SaveFormat.WEBP, quality);
    if (/\.webp$/i.test(webp.uri)) return { uri: webp.uri, ext: 'webp' };
  } catch {
    // fall through to JPEG
  }
  const jpeg = await render(uri, size, SaveFormat.JPEG, 0.85);
  return { uri: jpeg.uri, ext: 'jpg' };
}

export class PhotoError extends Error {}

/** `width` and `height` are the picked photo's size (the picker reports them, already upright). */
export async function compressPhoto(source: { uri: string; width: number; height: number }): Promise<OutboxPhoto> {
  try {
    const full = await encode(source.uri, fitWithin(source.width, source.height, FULL_MAX_EDGE), 0.82);
    const thumb = await (async () => {
      const t = await render(source.uri, fitWithin(source.width, source.height, THUMB_MAX_EDGE), full.ext === 'webp' ? SaveFormat.WEBP : SaveFormat.JPEG, 0.7);
      return t.uri;
    })();
    return { id: randomUUID(), fullUri: full.uri, thumbUri: thumb, ext: full.ext };
  } catch {
    throw new PhotoError("Couldn't prepare that photo. Please try another.");
  }
}
