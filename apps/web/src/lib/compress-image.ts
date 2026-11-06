// Photos are compressed in the browser before upload: at most 1600 px on the long edge, plus a small thumbnail, both
// WebP, or JPEG where the browser can't write WebP. (The same recipe as the phone app. A shared copy with the coach-profile image helper can replace this one
// once that helper is on main.)

export const FULL_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 320;
export const MAX_PHOTOS = 4;

/** The size that fits `width` x `height` inside a `max` px long edge, never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width, height };
  const scale = max / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type PhotoExt = 'webp' | 'jpg';

/** Storage paths for one photo: `{workspace}/{conversation}/{id}.{ext}` and its `-thumb.{ext}`. */
export function photoPaths(workspaceId: string, conversationId: string, photoId: string, ext: PhotoExt = 'webp'): { full: string; thumb: string } {
  const base = `${workspaceId}/${conversationId}/${photoId}`;
  return { full: `${base}.${ext}`, thumb: `${base}-thumb.${ext}` };
}

/** The thumbnail path of a stored photo path. */
export function thumbPathOf(fullPath: string): string {
  return fullPath.replace(/\.(webp|jpg)$/, '-thumb.$1');
}

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
