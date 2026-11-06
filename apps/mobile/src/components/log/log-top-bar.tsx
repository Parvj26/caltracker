import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { tapTarget } from '@caltracker/design-tokens';
import { formatClock } from '@caltracker/shared';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const CHEVRON_SIZE = 24;

/** Back chevron · "2 of 5" pill (opens the exercise list; hidden with no exercises) · elapsed timer · Finish. */
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
        <Svg width={CHEVRON_SIZE} height={CHEVRON_SIZE} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
          <Path d="M15 5 L8 12 L15 19" fill="none" stroke={palette.ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
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
