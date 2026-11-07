import { useCallback, useRef, useState, type RefObject } from 'react';
import { Alert, Linking, type HostInstance } from 'react-native';
import { SAVE_MESSAGES, saveCardToPhotos } from './save-image';

/**
 * "Save image" for a share card: saving shows a "Saved to Photos" toast; a refused permission explains itself and
 * offers Settings (iOS won't ask twice); any other failure says so and offers to try again. Never silent.
 */
export function useSaveCard(card: RefObject<HostInstance | null>) {
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const busy = useRef(false);

  const save = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setToast(null);
    const result = await saveCardToPhotos(card);
    busy.current = false;
    setSaving(false);
    if (result === 'saved') {
      setToast(SAVE_MESSAGES.saved);
    } else if (result === 'denied') {
      Alert.alert('Allow saving to Photos', SAVE_MESSAGES.denied, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]);
    } else {
      Alert.alert('Couldn’t save the image', 'Something went wrong while saving. Try again.', [
        { text: 'OK', style: 'cancel' },
        { text: 'Try again', onPress: () => void save() },
      ]);
    }
  }, [card]);

  return { saving, save, toast, clearToast: useCallback(() => setToast(null), []) };
}
