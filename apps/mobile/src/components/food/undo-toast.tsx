import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { font } from './food-type';

/** How long "Logged … · Undo" stays up. */
export const UNDO_MS = 5000;

/**
 * The ink bar after a one-tap log: "Logged Chicken rice bowl · 620 kcal" and a white Undo button. It is read out and
 * stays for UNDO_MS from each log (`id` changes per log, restarting the wait), then calls onHide. With VoiceOver on it
 * stays until Undo, the next log or leaving the screen, so there is time to reach the button.
 */
export function UndoToast({ id, message, onUndo, onHide }: { id: number; message: string | null; onUndo: () => void; onHide: () => void }) {
  const hide = useRef(onHide);
  hide.current = onHide;
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => alive && setScreenReader(on));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    AccessibilityInfo.announceForAccessibility(`${message}. Undo available.`);
  }, [message, id]);
  useEffect(() => {
    if (!message || screenReader) return;
    const t = setTimeout(() => hide.current(), UNDO_MS);
    return () => clearTimeout(t);
  }, [message, id, screenReader]);
  if (!message) return null;
  return (
    <View style={styles.bar} testID="food-undo-toast" accessibilityLiveRegion="polite">
      <Text style={[font(500, 15), styles.text]} numberOfLines={2}>
        {message}
      </Text>
      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        accessibilityLabel="Undo"
        testID="food-undo"
        style={({ pressed }) => [styles.undo, pressed && { opacity: pressedOpacity }]}
      >
        <Text style={font(800, 15)}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 52, borderRadius: 14, backgroundColor: palette.ink, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 4 },
  text: { flex: 1, color: white },
  undo: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, borderRadius: 22, backgroundColor: white, alignItems: 'center', justifyContent: 'center' },
});
