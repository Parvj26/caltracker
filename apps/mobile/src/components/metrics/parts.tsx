import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { SeriesPoint } from '@caltracker/shared';
import { sparklinePoints } from '@/lib/metrics-view';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const;

/** Apple Health's heart, as in the approved boards. Decorative. */
export function HeartIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...hidden}>
      <Path
        fill={palette.danger}
        d="M12 21s-7.5-4.6-9.3-9.2C1.4 8.4 3.6 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 16.4 12 21 12 21z"
      />
    </Svg>
  );
}

/** The heart on a white tile. */
export function HeartTile({ size = 40, tint = palette.bg }: { size?: number; tint?: string }) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size / 4, backgroundColor: tint }]}>
      <HeartIcon size={size * 0.55} />
    </View>
  );
}

/** A small trend line (decorative; the row reads the change aloud). */
export function Sparkline({ points, width = 96, height = 34 }: { points: readonly SeriesPoint[]; width?: number; height?: number }) {
  const pts = sparklinePoints(points, width, height);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...hidden}>
      {pts ? <Polyline points={pts} fill="none" stroke={palette.magenta} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  );
}

/** A labelled on/off row in the app's switch style (ink knob, lime track when on). */
export function SwitchRow({
  label,
  note,
  on,
  disabled = false,
  onToggle,
  testID,
  last = false,
}: {
  label: string;
  note?: string | null;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  testID: string;
  last?: boolean;
}) {
  const { text, space } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={note ? `${label}, ${note}` : label}
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.item, { gap: space[3] }, !last && styles.divider, (pressed || disabled) && styles.dim]}
    >
      <View style={[styles.flex, { gap: 2 }]}>
        <Text style={text('sectionHeading')}>{label}</Text>
        {note ? <Text style={text('caption')}>{note}</Text> : null}
      </View>
      <View style={[styles.track, on ? styles.trackOn : styles.trackOff]}>
        <View style={styles.knob} />
      </View>
    </Pressable>
  );
}

/** A tappable row: icon, title, a line under it, chevron. */
export function LinkRow({
  icon,
  title,
  sub,
  onPress,
  testID,
  tint = palette.drop,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
  testID: string;
  tint?: string;
}) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { gap: space[3], padding: space[3.5], borderRadius: radius.card - 2, backgroundColor: tint }, pressed && styles.dim]}
    >
      {icon}
      <View style={styles.flex}>
        <Text style={text('sectionHeading')}>{title}</Text>
        <Text style={text('caption')} testID={`${testID}-sub`}>
          {sub}
        </Text>
      </View>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.4} strokeLinecap="round" {...hidden}>
        <Path d="M9 5l7 7-7 7" />
      </Svg>
    </Pressable>
  );
}

const TRACK_W = 52;
const TRACK_H = 32;
const KNOB = 22;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 6 },
  divider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  dim: { opacity: pressedOpacity },
  link: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    justifyContent: 'center',
    paddingHorizontal: 3,
    minWidth: tapTarget.min,
  },
  trackOn: { backgroundColor: palette.lime, alignItems: 'flex-end' },
  trackOff: { backgroundColor: palette.surface, alignItems: 'flex-start' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: palette.ink },
});
