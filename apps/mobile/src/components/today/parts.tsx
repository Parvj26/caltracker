import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { typeScale } from '@caltracker/design-tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Above this text size, cards that sit side by side stack instead, so large Dynamic Type never squeezes them. */
const STACK_AT_FONT_SCALE = 1.3;

/** True when the client uses a large text size: side-by-side tiles stack. */
export function useStacked(): boolean {
  return useWindowDimensions().fontScale >= STACK_AT_FONT_SCALE;
}

export type TileTone = 'surface' | 'blue' | 'celebrateBg' | 'bg';

/**
 * A filled, rounded card on Today (no border, unlike Card). With `onPress` the whole tile is one button: give it
 * an `accessibilityLabel` that says what it shows and where it goes.
 */
export function Tile({
  tone = 'surface',
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  compact = false,
}: {
  tone?: TileTone;
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Smaller padding, for tiles inside a tile. */
  compact?: boolean;
}) {
  const { radius, space } = useTheme();
  const box = [
    { backgroundColor: palette[tone], borderRadius: compact ? radius.button : radius.card, padding: compact ? space[3] : space[4.5], gap: compact ? space[1] : space[3] },
    style,
  ];
  if (!onPress) {
    return (
      <View testID={testID} style={box}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [box, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

/** Small bold capitals over a card ("TODAY'S WORKOUT"). Ink, so it reads on every pastel. */
export function Overline({ children }: { children: string }) {
  return (
    <Text style={styles.overline} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** A quiet line for a card's loading, empty or offline state. */
export function Note({ children, testID, style }: { children: string; testID?: string; style?: StyleProp<TextStyle> }) {
  const { text } = useTheme();
  return (
    <Text testID={testID} style={[text('body'), styles.muted, style]}>
      {children}
    </Text>
  );
}

/** A rounded count on magenta ("2"). Decorative: the row's label says the number. */
export function CountBadge({ count }: { count: number }) {
  const { text, radius, space } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={[styles.badge, { borderRadius: radius.pill, paddingHorizontal: space[2] }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[text('sectionHeading'), styles.badgeText]}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  );
}

/** A thin progress bar (0 to 1). Decorative: the text beside it says the numbers. */
export function ProgressBar({ fraction }: { fraction: number }) {
  const { radius } = useTheme();
  return (
    <View style={[styles.track, { borderRadius: radius.pill }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.fill, { borderRadius: radius.pill, width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }]} />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  pressed: { opacity: pressedOpacity },
  overline: {
    fontFamily: fontFamilyFor('sans', typeScale.sectionHeading.weight),
    fontSize: typeScale.caption.size.phone,
    letterSpacing: typeScale.caption.size.phone * 0.06,
    textTransform: 'uppercase',
    color: palette.ink,
  },
  muted: { color: palette.inkMuted },
  badge: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.magenta },
  badgeText: { color: palette.bg },
  track: { height: 8, backgroundColor: palette.border, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: palette.ink },
  row: { flexDirection: 'row', alignItems: 'center' },
});
