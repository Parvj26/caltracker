import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { OFFLINE_PILL_NOTE, OFFLINE_PILL_TEXT, offlinePillA11y } from '@/lib/offline-pill';
import { fontFamilyFor } from '@/theme/fonts';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const DOT = 6;

/**
 * A screen's title with the small grey "Offline" pill beside it while the screen shows its saved copy (approved
 * less-text board LT9). Tapping the pill shows one line under the title; tapping again hides it. `children` is the
 * title itself (give it no flex: 1, so the pill sits right after the words). At large text the pill wraps under it.
 */
export function OfflineTitle({ offline, children, testID = 'offline-pill' }: { offline: boolean; children: ReactNode; testID?: string }) {
  const { text, space, radius } = useTheme();
  const [open, setOpen] = useState(false);
  // Back online: the note goes with the pill, and does not reappear open next time.
  useEffect(() => {
    if (!offline) setOpen(false);
  }, [offline]);
  const a11y = offlinePillA11y(open);
  return (
    <View style={{ gap: space[1] }}>
      <View style={[styles.row, { columnGap: space[2.5], rowGap: space[1] }]}>
        {children}
        {offline ? (
          <Pressable
            testID={testID}
            onPress={() => setOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={a11y.label}
            accessibilityHint={a11y.hint}
            accessibilityState={{ expanded: a11y.expanded }}
            hitSlop={{ top: (tapTarget.min - 28) / 2, bottom: (tapTarget.min - 28) / 2, left: space[1], right: space[1] }}
            style={({ pressed }) => [
              styles.pill,
              { borderRadius: radius.pill, paddingHorizontal: space[2.5], gap: space[1] },
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <View style={styles.dot} />
            <Text style={[text('caption'), styles.label]} maxFontSizeMultiplier={1.4}>
              {OFFLINE_PILL_TEXT}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {offline && open ? (
        <Text testID={`${testID}-note`} style={[text('caption'), styles.note]} accessibilityLiveRegion="polite">
          {OFFLINE_PILL_NOTE}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', minHeight: 28, backgroundColor: palette.surface },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: palette.inkMuted },
  label: { color: palette.inkMuted, fontFamily: fontFamilyFor('sans', 700) },
  note: { color: palette.inkMuted },
});
