import { Image, StyleSheet, View } from 'react-native';
import { palette } from '@/theme/theme';
import { BowlIcon } from './icons';

/**
 * A meal's square picture: its photo, or a calm grey tile with a bowl while there is none (or it hasn't loaded).
 * No coloured letter tiles and no "kcal" box (client review 2026-11-19).
 */
export function MealThumb({ uri, size = 44, radius = 10, testID }: { uri: string | undefined; size?: number; radius?: number; testID?: string }) {
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: radius }]} testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors testID="meal-photo" />
      ) : (
        <BowlIcon size={Math.round(size * 0.45)} color={palette.inkMuted} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
