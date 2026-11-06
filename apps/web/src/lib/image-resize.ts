/**
 * The one browser-side image path, used for the coach's photo and for chat photos. Both are decoded upright, drawn at
 * most 1600 px on the long edge plus a small thumbnail, and encoded as WebP (JPEG where the browser can't make WebP).
 * Avatars are centre-cropped to a square with a 256 px thumbnail; chat photos keep their shape with a 320 px thumbnail
 * (the sizes for chat photos live in @caltracker/shared).
 */

import { FULL_MAX_EDGE, THUMB_MAX_EDGE, fitWithin, type PhotoExt } from '@caltracker/shared';
import type { AvatarExt } from './avatar-files';

export const AVATAR_MAX_PX = 1600;
export const THUMB_PX = 256;
export const IMAGE_ERROR = "That image couldn't be used. Try a JPEG or PNG.";

export type SquareCrop = { sx: number; sy: number; side: number; size: number };

/**
 * The centred square of a w x h picture, and the size to draw it at: the side of the square, never more than `max`
 * (a small picture is not scaled up). Any shape, even an extreme panorama, gives a square.
 */
export function fitSquare(w: number, h: number, max: number): SquareCrop {
  const side = Math.max(1, Math.floor(Math.min(w, h)));
  return {
    sx: Math.floor((w - side) / 2),
    sy: Math.floor((h - side) / 2),
    side,
    size: Math.max(1, Math.min(side, Math.floor(max))),
  };
}

export type Encoded = { blob: Blob; ext: AvatarExt };
export type ToBlob = (type: string, quality: number) => Promise<Blob | null>;

/**
 * WebP first. Some browsers (older Safari) ignore the request and hand back a PNG, in which case the picture is
 * encoded as JPEG instead. Anything that is neither WebP nor JPEG is an error.
 */
export async function encodeWithFallback(toBlob: ToBlob, quality: number): Promise<Encoded> {
  const webp = await toBlob('image/webp', quality);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const jpeg = await toBlob('image/jpeg', quality);
  if (jpeg && jpeg.type === 'image/jpeg') return { blob: jpeg, ext: 'jpg' };
  throw new Error('no supported image encoder');
}

export type ProcessedAvatar = { avatar: Blob; thumb: Blob; ext: AvatarExt };

const canvasToBlob = (canvas: HTMLCanvasElement): ToBlob => (type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

type Source = ImageBitmap | HTMLImageElement;

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function drawSquare(source: Source, w: number, h: number, max: number): HTMLCanvasElement {
  const { sx, sy, side, size } = fitSquare(w, h, max);
  const { canvas, ctx } = canvasOf(size, size);
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/** The whole picture, scaled down (never up) to fit a `max` px long edge. */
function drawFit(source: Source, w: number, h: number, max: number): HTMLCanvasElement {
  const { width, height } = fitWithin(w, h, max);
  const { canvas, ctx } = canvasOf(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function decode(file: File): Promise<{ source: Source; w: number; h: number; close: () => void }> {
  try {
    // imageOrientation applies the camera's rotation, so phone photos are not sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Older browsers: an <img> element decodes (and rotates) it instead.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Throws an Error carrying IMAGE_ERROR when the file can't be decoded or re-encoded. */
export async function processAvatar(file: File): Promise<ProcessedAvatar> {
  try {
    const { source, w, h, close } = await decode(file);
    try {
      if (!(w > 0 && h > 0)) throw new Error('empty image');
      const avatar = await encodeWithFallback(canvasToBlob(drawSquare(source, w, h, AVATAR_MAX_PX)), 0.85);
      // Same format as the full picture, so the two files always share one extension.
      const thumbCanvas = drawSquare(source, w, h, THUMB_PX);
      const thumb = await canvasToBlob(thumbCanvas)(avatar.ext === 'webp' ? 'image/webp' : 'image/jpeg', 0.85);
      if (!thumb || thumb.type !== avatar.blob.type) throw new Error('thumbnail encoding failed');
      return { avatar: avatar.blob, thumb, ext: avatar.ext };
    } finally {
      close();
    }
  } catch {
    throw new Error(IMAGE_ERROR);
  }
}

/** A chat photo that can't be prepared; the message is shown to the coach. */
export class PhotoError extends Error {}

const PHOTO_ERROR = "This browser can't prepare photos.";

/** Decodes a picked chat photo (upright) and returns the full-size and thumbnail blobs, always in the same format. */
export async function compressPhoto(file: File): Promise<{ full: Blob; thumb: Blob; ext: PhotoExt }> {
  if (!file.type.startsWith('image/')) throw new PhotoError('Only photos can be sent.');
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    throw new PhotoError("That file isn't a photo this browser can read.");
  }
  const { source, w, h, close } = decoded;
  try {
    if (!(w > 0 && h > 0)) throw new PhotoError("That file isn't a photo this browser can read.");
    const full = await encodeWithFallback(canvasToBlob(drawFit(source, w, h, FULL_MAX_EDGE)), 0.85);
    // Same format as the full photo, so the photo and its thumbnail always share one extension (and path pattern).
    const thumb = await canvasToBlob(drawFit(source, w, h, THUMB_MAX_EDGE))(full.blob.type, 0.85);
    if (!thumb || thumb.type !== full.blob.type) throw new PhotoError(PHOTO_ERROR);
    return { full: full.blob, thumb, ext: full.ext };
  } catch (e) {
    throw e instanceof PhotoError ? e : new PhotoError(PHOTO_ERROR);
  } finally {
    close();
  }
}
