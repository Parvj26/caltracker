import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { exerciseImageUrl } from '@/lib/exercise-detail-api';
import { logPhotoHeight, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { PlaceholderIcon } from './exercise-thumb';

/** The start and end photos side by side (or the placeholder) with a How to button that opens the info sheet. */
export function ExercisePhoto({
  detail,
  name,
  page,
  onHowTo,
}: {
  detail: ExerciseDetail | undefined;
  name: string;
  page: number;
  onHowTo: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [failed, setFailed] = useState<string[]>([]);
  const paths = (detail?.imagePaths ?? []).slice(0, 2).filter((p) => !failed.includes(p));
  return (
    <View testID={`photo-${page}`} style={[styles.box, { borderRadius: radius.card }]}>
      {paths.length > 0 ? (
        <View style={styles.photos}>
          {paths.map((p, i) => (
            <Image
              key={p}
              source={{ uri: exerciseImageUrl(p) }}
              resizeMode="cover"
              accessibilityLabel={`${name} ${paths.length === 1 ? 'photo' : i === 0 ? 'start position' : 'end position'}`}
              style={styles.image}
              onError={() => setFailed((f) => [...f, p])}
            />
          ))}
        </View>
      ) : (
        <View style={styles.photos}>
          <PlaceholderIcon />
        </View>
      )}
      <Pressable
        testID={`how-to-${page}`}
        onPress={onHowTo}
        accessibilityRole="button"
        accessibilityLabel={`How to do ${name}`}
        style={({ pressed }) => [
          styles.howTo,
          { borderRadius: radius.pill, paddingHorizontal: space[3], right: space[2], bottom: space[2] },
          pressed && { opacity: pressedOpacity },
        ]}
      >
        <Text style={text('button')}>How to</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: logPhotoHeight,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: borderWidth.card,
    borderColor: palette.border,
  },
  photos: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1, height: '100%' },
  howTo: {
    position: 'absolute',
    minHeight: tapTarget.min,
    justifyContent: 'center',
    backgroundColor: palette.lime,
  },
});
