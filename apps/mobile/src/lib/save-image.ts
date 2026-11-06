// "Save image": renders a share card view to a picture in the photo library. The permission is asked once, the first time.
import * as MediaLibrary from 'expo-media-library';
import type { RefObject } from 'react';
import type { HostInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';

export type SaveImageResult = 'saved' | 'denied' | 'failed';

export const SAVE_MESSAGES: Record<SaveImageResult, string> = {
  saved: 'Saved to Photos.',
  denied: 'Allow CalTracker to add photos in Settings to save cards.',
  failed: 'Couldn’t save the image. Try again.',
};

export async function saveCardToPhotos(card: RefObject<HostInstance | null>): Promise<SaveImageResult> {
  try {
    // Write-only: the app adds pictures and never reads the library.
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) return 'denied';
    if (!card.current) return 'failed';
    const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
    await MediaLibrary.saveToLibraryAsync(uri);
    return 'saved';
  } catch {
    return 'failed';
  }
}
