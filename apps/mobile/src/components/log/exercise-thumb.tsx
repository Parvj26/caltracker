import { Image, Pressable, StyleSheet, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { exerciseImageUrl } from '@/lib/exercise-detail-api';
import { exerciseThumbSize, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** A neutral dumbbell for exercises with no photo (custom exercises). */
function PlaceholderIcon() {
  return (
    <View style={styles.dumbbell} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.plate, styles.plateSmall]} />
      <View style={styles.plate} />
      <View style={styles.bar} />
      <View style={styles.plate} />
      <View style={[styles.plate, styles.plateSmall]} />
    </View>
  );
}

/** The exercise's first photo as a small rounded square (or a placeholder). Tap opens its info sheet. */
export function ExerciseThumb({
  name,
  detail,
  testID,
  onPress,
}: {
  name: string;
  detail: ExerciseDetail | undefined;
  testID: string;
  onPress: () => void;
}) {
  const { radius } = useTheme();
  const first = detail?.imagePaths[0];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name} photo`}
      accessibilityHint="Opens exercise info"
      style={({ pressed }) => [styles.thumb, { borderRadius: radius.input }, pressed && { opacity: pressedOpacity }]}
    >
      {first ? (
        <Image source={{ uri: exerciseImageUrl(first) }} style={styles.image} resizeMode="cover" />
      ) : (
        <PlaceholderIcon />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: exerciseThumbSize,
    height: exerciseThumbSize,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: borderWidth.card,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  dumbbell: { flexDirection: 'row', alignItems: 'center' },
  bar: { width: 8, height: 3, backgroundColor: palette.inkMuted },
  plate: {
    width: 4,
    height: 16,
    borderRadius: 1,
    backgroundColor: palette.inkMuted,
  },
  plateSmall: { height: 10 },
});
