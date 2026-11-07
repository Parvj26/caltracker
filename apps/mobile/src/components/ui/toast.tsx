import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useReduceMotion } from './button';

/** How long a toast stays up before it fades away. */
export const TOAST_MS = 2600;

/**
 * A short confirmation ("Saved to Photos") shown as a dark pill where the person is looking. It fades in, is read out
 * by screen readers, and calls onHide after TOAST_MS so the owner can clear it.
 */
export function Toast({ message, onHide, testID }: { message: string | null; onHide: () => void; testID?: string }) {
  const { text, space, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const hide = useRef(onHide);
  hide.current = onHide;

  useEffect(() => {
    if (!message) return;
    AccessibilityInfo.announceForAccessibility(message);
    opacity.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const t = setTimeout(() => hide.current(), TOAST_MS);
    return () => clearTimeout(t);
  }, [message, opacity, reduceMotion]);

  if (!message) return null;
  return (
    <Animated.View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.pill, { opacity, borderRadius: radius.pill, paddingVertical: space[2], paddingHorizontal: space[4] }]}
    >
      <Text style={[text('button'), styles.label]}>✓ {message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'center', backgroundColor: palette.ink },
  label: { color: white },
});
