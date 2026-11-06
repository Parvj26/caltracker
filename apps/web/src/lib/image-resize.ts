/** Browser-side avatar processing: centre-crop to a square, then WebP (JPEG where the browser can't make WebP) at 1600 px max plus a 256 px thumbnail. */

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

export type AvatarExt = 'webp' | 'jpg';
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

function drawSquare(source: ImageBitmap | HTMLImageElement, w: number, h: number, max: number): HTMLCanvasElement {
  const { sx, sy, side, size } = fitSquare(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

async function decode(file: File): Promise<{ source: ImageBitmap | HTMLImageElement; w: number; h: number; close: () => void }> {
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
