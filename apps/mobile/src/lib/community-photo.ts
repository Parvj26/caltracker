// Picks photos and shrinks them on the phone before upload (spec §8): at most 1600 px on the long edge plus a 320 px
// thumbnail, WebP (JPEG if the phone can't write WebP). Files land in the app cache.
import { randomUUID } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { COMMUNITY_PHOTO_MAX_EDGE, COMMUNITY_THUMB_MAX_EDGE, fitLongEdge, type CommunityPhotoExt } from '@caltracker/shared';

export type PreparedPhoto = { id: string; fullUri: string; thumbUri: string; ext: CommunityPhotoExt; width: number; height: number };

export class PhotoError extends Error {}

async function render(uri: string, size: { width: number; height: number }, format: SaveFormat, compress: number) {
  const ref = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  return ref.saveAsync({ format, compress });
}

async function encode(uri: string, size: { width: number; height: number }): Promise<{ uri: string; ext: CommunityPhotoExt }> {
  try {
    const webp = await render(uri, size, SaveFormat.WEBP, 0.82);
    if (/\.webp$/i.test(webp.uri)) return { uri: webp.uri, ext: 'webp' };
  } catch {
    // fall through to JPEG
  }
  const jpeg = await render(uri, size, SaveFormat.JPEG, 0.85);
  return { uri: jpeg.uri, ext: 'jpg' };
}

/** `width` and `height` are the picked photo's size (the picker reports them, already upright). */
export async function preparePhoto(source: { uri: string; width: number; height: number }): Promise<PreparedPhoto> {
  try {
    const size = fitLongEdge(source.width, source.height, COMMUNITY_PHOTO_MAX_EDGE);
    const full = await encode(source.uri, size);
    const thumb = await render(
      source.uri,
      fitLongEdge(source.width, source.height, COMMUNITY_THUMB_MAX_EDGE),
      full.ext === 'webp' ? SaveFormat.WEBP : SaveFormat.JPEG,
      0.7,
    );
    return { id: randomUUID(), fullUri: full.uri, thumbUri: thumb.uri, ext: full.ext, ...size };
  } catch {
    throw new PhotoError('Couldn’t prepare that photo. Please try another.');
  }
}

/** Opens the photo library (photos only, never video) for up to `max` photos. Empty when cancelled. */
export async function pickPhotos(max: number): Promise<{ uri: string; width: number; height: number }[]> {
  if (max <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: max,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, max).map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}
