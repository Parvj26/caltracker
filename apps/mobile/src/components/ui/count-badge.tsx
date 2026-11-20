import { StyleSheet, Text, View } from 'react-native';
import { fontFamilyFor } from '@/theme/fonts';
import { palette, white } from '@/theme/theme';

/** Badges stop growing past this text size, so they never cover what they sit on. */
const MAX_SCALE = 1.4;

/**
 * The app's one badge (Patterns board): a blue count pill with white text, the same as the tab bar's. `corner` pins it
 * to the top-right of a round button (e.g. the bell). Decorative: the button's label says the count.
 */
export function CountBadge({ label, corner = false, testID }: { label: string; corner?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={[styles.pill, corner && styles.corner]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.text} maxFontSizeMultiplier={MAX_SCALE} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { minWidth: 20, minHeight: 20, paddingHorizontal: 6, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.magenta },
  corner: { position: 'absolute', top: -2, right: -2 },
  text: { color: white, fontSize: 12, fontFamily: fontFamilyFor('sans', 800) },
});
