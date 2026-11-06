import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { formatClock } from '@caltracker/shared';
import { contentMaxWidth, palette, pressedOpacity, restClock, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Past this, the rest ended while the client was away: the buzz would only startle them, so it is skipped. */
const LATE_MS = 2000;
const TICK_MS = 250;

/**
 * Rest countdown docked at the bottom, over the list (the client can keep scrolling and ticking).
 * Counts down to a fixed end time, so it stays right after the phone sleeps or the screen is left.
 * Calls onDone once at zero, with late = true when zero passed more than 2 s ago.
 */
export function RestSheet({
  endsAt,
  onAdjust,
  onSkip,
  onDone,
  onHeight,
}: {
  /** Epoch ms when the rest is over. */
  endsAt: number;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
  onDone: (late: boolean) => void;
  /** The sheet's height, so the screen can keep room for it under the last set. */
  onHeight: (h: number) => void;
}) {
  const { text, space, radius } = useTheme();
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onDone(Date.now() - endsAt > LATE_MS);
  }, [left, endsAt, onDone]);

  return (
    <SafeAreaView
      edges={['bottom']}
      testID="rest-sheet"
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[styles.sheet, { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}
    >
      <View style={[styles.body, { padding: space[4.5], gap: space[3] }]}>
        <View style={styles.centreCol}>
          <Text style={[text('caption'), styles.onInk]}>Rest</Text>
          <Text
            style={[text('bigNumber'), styles.onInk, restClock]}
            accessibilityRole="timer"
            accessibilityLabel={`${left} seconds of rest left`}
            accessibilityLiveRegion="polite"
          >
            {formatClock(left)}
          </Text>
        </View>
        <View style={[styles.buttons, { gap: space[2.5] }]}>
          <SheetButton testID="rest-minus" title="−15 s" label="15 seconds less" onPress={() => onAdjust(-15)} />
          <SheetButton testID="rest-plus" title="+15 s" label="15 seconds more" onPress={() => onAdjust(15)} />
          <SheetButton testID="rest-skip" title="Skip" label="Skip rest" onPress={onSkip} strong />
        </View>
      </View>
    </SafeAreaView>
  );
}

function SheetButton({
  title,
  label,
  testID,
  onPress,
  strong = false,
}: {
  title: string;
  label: string;
  testID: string;
  onPress: () => void;
  strong?: boolean;
}) {
  const { text, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { borderRadius: radius.button },
        strong ? styles.buttonStrong : styles.buttonQuiet,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[text('button'), strong ? styles.ink : styles.onInk]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: palette.ink },
  body: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  centreCol: { alignItems: 'center' },
  onInk: { color: white },
  ink: { color: palette.ink },
  buttons: { flexDirection: 'row' },
  button: {
    flex: 1,
    minHeight: tapTarget.logging,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
  },
  buttonQuiet: { borderColor: white },
  buttonStrong: { backgroundColor: palette.lime, borderColor: palette.lime },
  pressed: { opacity: pressedOpacity },
});
