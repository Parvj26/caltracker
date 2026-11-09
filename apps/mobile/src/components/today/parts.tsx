import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { typeScale } from '@caltracker/design-tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';

/** Above this text size, cards that sit side by side stack instead, so large Dynamic Type never squeezes them. */
const STACK_AT_FONT_SCALE = 1.3;

/** True when the client uses a large text size: side-by-side tiles stack. */
export function useStacked(): boolean {
  return useWindowDimensions().fontScale >= STACK_AT_FONT_SCALE;
}

/** Small bold capitals over a card ("TODAY'S WORKOUT"). Ink, so it reads on every pastel. */
export function Overline({ children }: { children: string }) {
  return (
    <Text style={styles.overline} accessibilityRole="header">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  overline: {
    fontFamily: fontFamilyFor('sans', typeScale.screenTitle.weight),
    fontSize: typeScale.caption.size.phone,
    letterSpacing: typeScale.caption.size.phone * 0.06,
    textTransform: 'uppercase',
    color: palette.ink,
  },
});
