import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { formatClock } from '@caltracker/shared';
import { ringFraction } from '@/lib/rest-ring';
import { palette, pressedOpacity, restClock, restRingSize, restRingStroke } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Past this, the rest ended while the client was away: the buzz would only startle them, so it is skipped. */
const LATE_MS = 2000;
const TICK_MS = 250;

/**
 * Rest countdown with a ring that empties as the time runs out, shown in place of the set controls.
 * Counts down to a fixed end time, so it stays right after the phone sleeps or the screen is left.
 * Calls onDone once at zero, with late = true when zero passed more than 2 s ago.
 */
export function RestPanel({
  endsAt,
  totalS,
  nextLine,
  onAdjust,
  onSkip,
  onDone,
}: {
  /** Epoch ms when the rest is over. */
  endsAt: number;
  /** The rest length the ring counts against. */
  totalS: number;
  /** What comes next ("Next: ..."), or null when nothing does. */
  nextLine: string | null;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
  onDone: (late: boolean) => void;
}) {
  const { text, space } = useTheme();
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onDone(Date.now() - endsAt > LATE_MS);
  }, [left, endsAt, onDone]);

  const r = (restRingSize - restRingStroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = ringFraction(endsAt, totalS, now);

  return (
    <View testID="rest-panel" style={[styles.panel, { gap: space[3] }]}>
      <View style={[styles.ring, { width: restRingSize, height: restRingSize }]}>
        <Svg width={restRingSize} height={restRingSize} style={StyleSheet.absoluteFill}>
          <Circle
            cx={restRingSize / 2}
            cy={restRingSize / 2}
            r={r}
            stroke={palette.border}
            strokeWidth={restRingStroke}
            fill="none"
          />
          <Circle
            cx={restRingSize / 2}
            cy={restRingSize / 2}
            r={r}
            stroke={palette.lime}
            strokeWidth={restRingStroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - fraction)}
            transform={`rotate(-90 ${restRingSize / 2} ${restRingSize / 2})`}
          />
        </Svg>
        <Text
          style={[text('bigNumber'), styles.ink, restClock]}
          accessibilityRole="timer"
          accessibilityLabel={`${left} seconds of rest left`}
          accessibilityLiveRegion="polite"
        >
          {formatClock(left)}
        </Text>
      </View>
      {nextLine ? (
        <Text testID="rest-next" style={[text('caption'), styles.ink]}>
          {nextLine}
        </Text>
      ) : null}
      <View style={[styles.buttons, { gap: space[2.5] }]}>
        <PanelButton testID="rest-minus" title="−15 s" label="15 seconds less" onPress={() => onAdjust(-15)} />
        <PanelButton testID="rest-plus" title="+15 s" label="15 seconds more" onPress={() => onAdjust(15)} />
        <PanelButton testID="rest-skip" title="Skip" label="Skip rest" onPress={onSkip} strong />
      </View>
    </View>
  );
}

function PanelButton({
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
      <Text style={[text('button'), styles.ink]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { alignItems: 'center', width: '100%' },
  ring: { alignItems: 'center', justifyContent: 'center' },
  ink: { color: palette.ink },
  buttons: { flexDirection: 'row', width: '100%' },
  button: {
    flex: 1,
    minHeight: tapTarget.logging,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
  },
  buttonQuiet: { borderColor: palette.ink },
  buttonStrong: { backgroundColor: palette.lime, borderColor: palette.lime },
  pressed: { opacity: pressedOpacity },
});
