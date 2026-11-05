import { Image, StyleSheet, Text, View } from 'react-native';
import { typeScale } from '@caltracker/design-tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';
// Generated from packages/design-tokens/assets/logo-mark.svg by scripts/generate-logo.ts (@2x/@3x picked by density).
import logoMark from '../../../assets/images/logo-mark.png';

const SIZE = { md: 19, lg: 34 } as const;

/** The CalTracker mark (a "C" progress ring with a pink dot) next to the lowercase wordmark.
 *  Read as one image named CalTracker. */
export function Logo({ size = 'md' }: { size?: keyof typeof SIZE }) {
  const fontSize = SIZE[size];
  const markSize = Math.round(fontSize * 1.45);
  const font = {
    fontFamily: fontFamilyFor('sans', 800),
    fontSize,
    letterSpacing: size === 'lg' ? Math.round((typeScale.screenTitle.trackingEm ?? 0) * fontSize * 100) / 100 : 0,
  };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="CalTracker" style={[styles.row, { gap: fontSize * 0.36 }]}>
      <Image source={logoMark} style={{ width: markSize, height: markSize }} />
      <Text style={[styles.text, font]} maxFontSizeMultiplier={1.4}>
        caltracker
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  text: { color: palette.ink },
});
