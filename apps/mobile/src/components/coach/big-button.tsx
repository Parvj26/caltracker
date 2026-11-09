import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, buttonBase, pressDepth } from '@caltracker/design-tokens';
import { useReduceMotion } from '@/components/ui/button';
import { palette, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const RADIUS = 18;

/**
 * One of the Coach profile's big buttons: a coloured face with an ink outline on a 4 pt ink base, an icon, a label
 * and an optional count pill ("3 new"). Sinks 2 pt when pressed (fades instead with Reduce Motion).
 */
export function BigButton({ label, icon, fill, badge, onPress, testID, accessibilityLabel }: {
  label: string;
  icon: ReactNode;
  fill: string;
  badge?: string | null;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { text } = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (badge ? `${label}, ${badge}` : label)}
      onPress={onPress}
      style={styles.wrap}
    >
      {({ pressed }) => (
        <>
          <View style={styles.base} />
          <View style={[styles.face, { backgroundColor: fill }, pressed && (reduceMotion ? styles.faded : styles.sunk)]}>
            {icon}
            <Text style={[text('button'), styles.label]} numberOfLines={1}>{label}</Text>
            {badge ? (
              <View style={styles.pill}>
                <Text style={[text('sectionHeading'), styles.pillText]}>{badge}</Text>
              </View>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', paddingBottom: buttonBase },
  base: { position: 'absolute', left: 0, right: 0, bottom: 0, top: buttonBase, borderRadius: RADIUS, backgroundColor: palette.ink },
  face: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2.5],
    paddingHorizontal: space[4],
    borderRadius: RADIUS,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
  },
  label: { fontSize: 17, flexShrink: 1 },
  sunk: { transform: [{ translateY: pressDepth }] },
  faded: { opacity: 0.75 },
  pill: { borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 3, backgroundColor: palette.ink },
  pillText: { color: white, fontSize: 12 },
});
