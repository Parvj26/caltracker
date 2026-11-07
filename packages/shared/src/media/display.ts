// How a stored photo (1600 px long edge plus a 320 px thumbnail) is shown on screen: the size it takes in a card or
// bubble without cropping, and whether the thumbnail is sharp enough at that size or the full photo is needed.

import { THUMB_MAX_EDGE } from '../messages/photos';

export type PhotoSize = { width: number; height: number };

const valid = (s: PhotoSize | null | undefined): s is PhotoSize =>
  !!s && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0;

/**
 * The on-screen size of a photo shown whole (never cropped): as wide as `maxWidth`, unless that makes it taller than
 * `maxHeight`, then as tall as `maxHeight` and narrower. An unknown size gets a square placeholder.
 */
export function photoDisplaySize(natural: PhotoSize | null | undefined, box: { maxWidth: number; maxHeight: number }): PhotoSize {
  if (!valid(natural)) {
    const side = Math.max(1, Math.round(Math.min(box.maxWidth, box.maxHeight)));
    return { width: side, height: side };
  }
  const scale = Math.min(box.maxWidth / natural.width, box.maxHeight / natural.height);
  return { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
}

/**
 * Which stored file to show at `display` size (in points / CSS px) on a screen with `pixelRatio` device pixels per
 * point: the thumbnail only when its long edge has at least as many pixels as the screen draws, else the full photo.
 * Stretching the thumbnail is what made photos look blurry.
 */
export function photoSourceFor(display: PhotoSize, pixelRatio: number, thumbMaxEdge: number = THUMB_MAX_EDGE): 'thumb' | 'full' {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const needed = Math.max(display.width, display.height) * ratio;
  return needed <= thumbMaxEdge ? 'thumb' : 'full';
}
