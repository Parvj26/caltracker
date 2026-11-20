import { useNavigation, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

/**
 * "Discard changes?" for a sheet or page with typing in it (Patterns board). While `dirty`, every way out asks first:
 * the × (which just goes back), iOS swipe-down on a sheet, swipe-back and Android Back. With nothing typed it closes at
 * once. After a save, leave through `leave(go)`, which skips the question.
 */
export function useDiscardGuard(dirty: boolean): { leave: (go: () => void) => void } {
  const navigation = useNavigation();
  const [released, setReleased] = useState(false);
  const after = useRef<(() => void) | null>(null);

  usePreventRemove(dirty && !released, ({ data }) => {
    Alert.alert('Discard changes?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          after.current = () => navigation.dispatch(data.action);
          setReleased(true);
        },
      },
    ]);
  });

  // The guard is off once React has re-rendered without it; only then can the screen go.
  useEffect(() => {
    if (!released || !after.current) return;
    const go = after.current;
    after.current = null;
    go();
  }, [released]);

  const leave = useCallback(
    (go: () => void) => {
      if (!dirty || released) {
        go();
        return;
      }
      after.current = go;
      setReleased(true);
    },
    [dirty, released],
  );
  return { leave };
}

/**
 * The same question for a React Native Modal sheet (which can't hold back its own swipe-down: give it
 * `allowSwipeDismissal={!dirty}`, so with typing in it only the ×, which asks, closes it).
 */
export function closeAsking(dirty: boolean, close: () => void): void {
  if (!dirty) {
    close();
    return;
  }
  Alert.alert('Discard changes?', undefined, [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: close },
  ]);
}
