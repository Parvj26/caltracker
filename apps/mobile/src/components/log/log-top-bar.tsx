import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { formatClock } from '@caltracker/shared';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** ‹ back · "2 of 5" pill (opens the exercise list; hidden with no exercises) · elapsed timer · Finish. */
export function LogTopBar({
  pill,
  elapsedS,
  onBack,
  onPill,
  onFinish,
}: {
  pill: string | null;
  elapsedS: number;
  onBack: () => void;
  onPill: () => void;
  onFinish: () => void;
}) {
  const { text, space, radius } = useTheme();
  return (
    <View style={[styles.row, { gap: space[2] }]}>
      <Pressable
        testID="log-back"
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [styles.square, pressed && styles.pressed]}
      >
        <Text style={[text('screenTitle'), styles.ink]}>‹</Text>
      </Pressable>
      {pill ? (
        <Pressable
          testID="log-pill"
          onPress={onPill}
          accessibilityRole="button"
          accessibilityLabel={`Exercise ${pill}, open the exercise list`}
          style={({ pressed }) => [
            styles.pill,
            { borderRadius: radius.pill, paddingHorizontal: space[3] },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[text('button'), styles.ink]}>{pill}</Text>
        </Pressable>
      ) : null}
      <Text
        testID="log-timer"
        accessibilityRole="timer"
        accessibilityLabel={`${Math.floor(elapsedS / 60)} minutes in`}
        style={[text('bigNumber'), styles.timer, styles.ink]}
        numberOfLines={1}
      >
        {formatClock(elapsedS)}
      </Text>
      <Pressable
        testID="finish-workout"
        onPress={onFinish}
        accessibilityRole="button"
        accessibilityLabel="Finish workout"
        style={({ pressed }) => [
          styles.finish,
          { borderRadius: radius.button, paddingHorizontal: space[4] },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[text('button'), { color: white }]}>Finish</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  square: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  pill: {
    minHeight: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.lime,
  },
  timer: { flex: 1, textAlign: 'center' },
  finish: {
    minHeight: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.magenta,
  },
  ink: { color: palette.ink },
  pressed: { opacity: pressedOpacity },
});
