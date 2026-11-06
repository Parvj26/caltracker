import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { exerciseImageUrl } from '@/lib/exercise-detail-api';
import { exerciseThumbSize, palette, pressedOpacity, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** A neutral dumbbell for exercises with no photo (custom exercises). */
export function PlaceholderIcon() {
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

/**
 * The exercise's first photo as a small rounded square (or a placeholder). Tap opens its info sheet. Without
 * onPress it is only a picture inside something tappable (a pick-one card): no tap and no screen-reader stop.
 */
export function ExerciseThumb({
  name,
  detail,
  testID,
  onPress,
}: {
  name: string;
  detail: ExerciseDetail | undefined;
  testID: string;
  onPress?: () => void;
}) {
  const { radius } = useTheme();
  const first = detail?.imagePaths[0];
  // A photo that can't load (offline, removed) shows the placeholder instead of an empty square.
  const [failed, setFailed] = useState<string | null>(null);
  const photo =
    first && failed !== first ? (
      <Image
        source={{ uri: exerciseImageUrl(first) }}
        style={styles.image}
        resizeMode="cover"
        onError={() => setFailed(first)}
      />
    ) : (
      <PlaceholderIcon />
    );
  if (!onPress) {
    return (
      <View
        testID={testID}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.thumb, { borderRadius: radius.input }]}
      >
        {photo}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name} photo`}
      // Screen readers skip the photo: something beside it offers the same sheet, so they stop once. On the
      // logging screens the name opens it; on the workout preview the exercise row has an "Exercise info" action.
      accessibilityElementsHidden
      importantForAccessibility="no"
      hitSlop={space[1]}
      style={({ pressed }) => [styles.thumb, { borderRadius: radius.input }, pressed && { opacity: pressedOpacity }]}
    >
      {photo}
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
  bar: { width: space[2], height: borderWidth.card, backgroundColor: palette.inkMuted },
  plate: { width: space[1], height: space[4], borderRadius: borderWidth.card / 2, backgroundColor: palette.inkMuted },
  plateSmall: { height: space[2.5] },
});
