// "Save image": renders a share card view to a picture in the photo library. The permission is asked once, the first time.
//
// expo-media-library 58 replaced its functions with classes: the old `saveToLibraryAsync` exported from the package
// root now throws on every call (it only survives under "expo-media-library/legacy"). Saving goes through
// `Asset.create`, which needs only add-only access.
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import type { RefObject } from 'react';
import type { HostInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { saveCard, type SaveImageResult } from './save-image-logic';

export { SAVE_MESSAGES, type SaveImageResult } from './save-image-logic';

export function saveCardToPhotos(card: RefObject<HostInstance | null>): Promise<SaveImageResult> {
  return saveCard({
    // Write-only: the app adds pictures and never reads the library.
    requestAddPermission: async () => (await requestPermissionsAsync(true)).granted,
    capture: async (fallback) => {
      if (!card.current) throw new Error('The share card is not on screen yet.');
      return captureRef(card, { format: 'png', quality: 1, result: 'tmpfile', useRenderInContext: fallback });
    },
    addToLibrary: async (uri) => {
      await Asset.create(uri);
    },
    report: (step, error) => {
      if (__DEV__) console.warn(`Save image failed at ${step}`, error);
    },
  });
}
