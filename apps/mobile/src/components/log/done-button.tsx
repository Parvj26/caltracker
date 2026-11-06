import { Pressable, StyleSheet, Text } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { doneButtonHeight, palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** The full-width Done button; its label says what happens next ("Done · start rest 1:30"). */
export function DoneButton({ label, page, onPress }: { label: string; page: number; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
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
