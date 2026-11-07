// Takes or chooses a meal photo and shrinks it on the phone (1600 px long edge plus a 320 px thumbnail), ready for
// the meal editor. Null when the person cancels.
import * as ImagePicker from 'expo-image-picker';
import { FULL_MAX_EDGE, fitWithin } from '@caltracker/shared';
import { PhotoError, compressPhoto } from './compress-photo';
import type { LocalMealPhoto } from './food-queue';

export type PickedMealPhoto = { local: LocalMealPhoto; width: number; height: number };

export async function pickMealPhoto(source: 'camera' | 'library'): Promise<PickedMealPhoto | null> {
  let res: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PhotoError('Allow camera access for CalTracker in Settings to take a photo.');
    res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  } else {
    res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  }
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset) return null;
  const local = await compressPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
  const size = fitWithin(asset.width, asset.height, FULL_MAX_EDGE);
  return { local, width: size.width, height: size.height };
}

/** The picked photo as route params for the meal editor (and back). */
export function photoParams(p: PickedMealPhoto): Record<string, string> {
  return { photoId: p.local.id, full: p.local.fullUri, thumb: p.local.thumbUri, ext: p.local.ext, w: String(p.width), h: String(p.height) };
}

export function photoFromParams(q: Record<string, string | string[] | undefined>): PickedMealPhoto | null {
  const one = (k: string) => (typeof q[k] === 'string' ? q[k] : undefined);
  const [id, full, thumb, ext, w, h] = ['photoId', 'full', 'thumb', 'ext', 'w', 'h'].map(one);
  if (!id || !full || !thumb || (ext !== 'webp' && ext !== 'jpg')) return null;
  const width = Number(w);
  const height = Number(h);
  if (!(width > 0 && height > 0)) return null;
  return { local: { id, fullUri: full, thumbUri: thumb, ext }, width, height };
}
