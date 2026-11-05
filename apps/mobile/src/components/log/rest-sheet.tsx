import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import { formatClock } from '@caltracker/shared';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Rest countdown docked at the bottom, over the list (the client can keep scrolling and ticking).
 * Counts down to a fixed end time, so it stays right after the phone sleeps. Calls onDone once at zero.
 */
export function RestSheet({
  endsAt,
  onAdjust,
  onSkip,
  onDone,
}: {
  /** Epoch ms when the rest is over. */
  endsAt: number;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
  onDone: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  return (
    <SafeAreaView
      edges={['bottom']}
      testID="rest-sheet"
      style={[styles.sheet, { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}
    >
      <View style={[styles.body, { padding: space[4.5], gap: space[3] }]}>
        <View style={styles.centreCol}>
          <Text style={[text('caption'), styles.onInk]}>Rest</Text>
          <Text
            style={[text('bigNumber'), styles.onInk, styles.clock]}
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
  body: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  centreCol: { alignItems: 'center' },
  clock: { fontSize: 44, lineHeight: 52 },
  onInk: { color: white },
  ink: { color: palette.ink },
  buttons: { flexDirection: 'row' },
  button: { flex: 1, minHeight: tapTarget.logging, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  buttonQuiet: { borderColor: white },
  buttonStrong: { backgroundColor: palette.lime, borderColor: palette.lime },
  pressed: { opacity: 0.75 },
});
