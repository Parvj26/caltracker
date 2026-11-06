/**
 * Browser-side processing of a community photo before upload (spec §8): no crop, at most 1600 px on the long edge
 * plus a 320 px thumbnail, WebP (JPEG where the browser can't make WebP).
 */
import { COMMUNITY_PHOTO_MAX_EDGE, COMMUNITY_THUMB_MAX_EDGE, fitLongEdge, type CommunityPhotoExt } from '@caltracker/shared';
import { encodeWithFallback, type ToBlob } from './image-resize';

export const PHOTO_ERROR = "That photo couldn't be used. Try a JPEG or PNG.";

export type ProcessedPhoto = { full: Blob; thumb: Blob; ext: CommunityPhotoExt; width: number; height: number };

const canvasToBlob = (canvas: HTMLCanvasElement): ToBlob => (type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

function draw(source: CanvasImageSource, w: number, h: number, max: number): HTMLCanvasElement {
  const size = fitLongEdge(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

export async function processCommunityPhoto(file: File): Promise<ProcessedPhoto> {
  try {
    // imageOrientation applies the camera's rotation, so phone photos are not sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const { width: w, height: h } = bitmap;
      if (!(w > 0 && h > 0)) throw new Error('empty image');
      const fullCanvas = draw(bitmap, w, h, COMMUNITY_PHOTO_MAX_EDGE);
      const full = await encodeWithFallback(canvasToBlob(fullCanvas), 0.82);
      const thumb = await canvasToBlob(draw(bitmap, w, h, COMMUNITY_THUMB_MAX_EDGE))(full.ext === 'webp' ? 'image/webp' : 'image/jpeg', 0.7);
      if (!thumb || thumb.type !== full.blob.type) throw new Error('thumbnail encoding failed');
      return { full: full.blob, thumb, ext: full.ext, width: fullCanvas.width, height: fullCanvas.height };
    } finally {
      bitmap.close();
    }
  } catch {
    throw new Error(PHOTO_ERROR);
  }
}
