// Photos are compressed in the browser before upload: at most 1600 px on the long edge, plus a small thumbnail, both
// WebP, or JPEG where the browser can't write WebP. (The same recipe as the phone app; the size and path rules live in @caltracker/shared.)

import { FULL_MAX_EDGE, THUMB_MAX_EDGE, fitWithin, type PhotoExt } from '@caltracker/shared';



export class PhotoError extends Error {}

export type Encoded = { blob: Blob; ext: PhotoExt };

/**
 * WebP when the browser can write it; otherwise (Safari hands back a PNG for a WebP request) the same picture as JPEG
 * at quality 0.85. `toBlob` is the canvas encoder, passed in so the choice can be tested.
 */
export async function encodeWithFallback(toBlob: (type: string, quality: number) => Promise<Blob | null>): Promise<Encoded> {
  const webp = await toBlob('image/webp', 0.82);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const jpeg = await toBlob('image/jpeg', 0.85);
  if (jpeg && jpeg.type === 'image/jpeg') return { blob: jpeg, ext: 'jpg' };
  throw new PhotoError("This browser can't prepare photos.");
}

function encode(source: ImageBitmap, max: number): Promise<Encoded> {
  const { width, height } = fitWithin(source.width, source.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError("This browser can't prepare photos.");
  ctx.drawImage(source, 0, 0, width, height);
  return encodeWithFallback((type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)));
}

/** Decodes a picked photo (upright) and returns the full-size and thumbnail blobs (both the same format). */
export async function compressPhoto(file: File): Promise<{ full: Blob; thumb: Blob; ext: PhotoExt }> {
  if (!file.type.startsWith('image/')) throw new PhotoError('Only photos can be sent.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError("That file isn't a photo this browser can read.");
  }
  try {
    const full = await encode(bitmap, FULL_MAX_EDGE);
    const thumb = await encode(bitmap, THUMB_MAX_EDGE);
    // Both sizes come from the same browser and normally end up in the same format. If they differ, refuse rather
    // than store a photo and a thumbnail whose paths would not match.
    if (full.ext !== thumb.ext) throw new PhotoError("This browser can't prepare photos.");
    return { full: full.blob, thumb: thumb.blob, ext: full.ext };
  } finally {
    bitmap.close();
  }
}
