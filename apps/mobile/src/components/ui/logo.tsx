import { StyleSheet, Text, View } from 'react-native';
import { typeScale } from '@caltracker/design-tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';

const SIZE = { md: 19, lg: 34 } as const;

/** Wordmark: a lime "Cal" tile followed by "Tracker". Read as one image named CalTracker. */
export function Logo({ size = 'md' }: { size?: keyof typeof SIZE }) {
  const fontSize = SIZE[size];
  const font = {
    fontFamily: fontFamilyFor('sans', 800),
    fontSize,
    letterSpacing: size === 'lg' ? Math.round((typeScale.screenTitle.trackingEm ?? 0) * fontSize * 100) / 100 : 0,
  };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="CalTracker" style={styles.row}>
      <View style={[styles.mark, { borderRadius: fontSize * 0.42, paddingHorizontal: fontSize * 0.3, paddingVertical: fontSize * 0.14 }]}>
        <Text style={[styles.text, font]} maxFontSizeMultiplier={1.4}>
          Cal
        </Text>
      </View>
      <Text style={[styles.text, font, { marginLeft: fontSize * 0.08 }]} maxFontSizeMultiplier={1.4}>
        Tracker
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  mark: { backgroundColor: palette.lime },
  text: { color: palette.ink },
});
