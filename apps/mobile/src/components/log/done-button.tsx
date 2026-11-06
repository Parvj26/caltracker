import { useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, type View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { doneButtonHeight, palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useKeepAboveKeyboard } from './keyboard-reveal';

/** The full-width Done button; its label says what happens next ("Done · start rest 1:30"). */
export function DoneButton({ label, page, onPress }: { label: string; page: number; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  const ref = useRef<ComponentRef<typeof View>>(null);
  // Typing a number brings up the keypad; Done stays in reach above it.
  useKeepAboveKeyboard(ref);
  return (
    <Pressable
      ref={ref}
      testID={`done-${page}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { borderRadius: radius.button, paddingHorizontal: space[4] },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[text('button'), styles.label]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    minHeight: doneButtonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.ink,
    borderBottomWidth: borderWidth.card * 2,
    borderBottomColor: palette.lime,
  },
  label: { color: white, textAlign: 'center' },
  pressed: { opacity: pressedOpacity },
});
