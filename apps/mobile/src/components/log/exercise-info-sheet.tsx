import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { exerciseDemoUrl } from '@/lib/demo-link';
import { exerciseImageUrl } from '@/lib/exercise-detail-api';
import { openDemo } from '@/lib/open-demo';
import { Button, TextButton } from '@/components/ui';
import { contentMaxWidth, exercisePhotoHeight, palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** "quadriceps" -> "Quadriceps" (the data stores muscles in lower case). */
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What an exercise is: start and end photos, muscles, equipment, numbered steps and a "Watch demo" button (the saved
 * YouTube video, or a YouTube search for the exercise when there is none). Same page-sheet pattern as the note sheet. `detail` is undefined while it loads or when
 * it was never loaded and the phone is offline.
 */
export function ExerciseInfoSheet({
  name,
  detail,
  onClose,
}: {
  /** Null hides the sheet. */
  name: string | null;
  detail: ExerciseDetail | undefined;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  const muscles = detail ? [...detail.primaryMuscles, ...detail.secondaryMuscles] : [];
  // Re-checked here as well as when it was loaded: a real YouTube video link, else a YouTube search for the exercise.
  const videoUrl = exerciseDemoUrl(detail?.videoUrl, name);

  return (
    <Modal visible={name !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <ScrollView
          testID="exercise-sheet"
          contentContainerStyle={[styles.column, { padding: space[4], gap: space[4] }]}
        >
          {/* Close sits at the top so it is always on screen, however long the instructions are. */}
          <View style={[styles.titleRow, { gap: space[2] }]}>
            <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header" testID="exercise-sheet-name">
              {name ?? ''}
            </Text>
            <TextButton testID="exercise-sheet-close" title="Close" onPress={onClose} />
          </View>

          {detail && detail.imagePaths.length > 0 ? (
            <View style={{ gap: space[2] }}>
              {detail.imagePaths.slice(0, 2).map((p, i, shown) => (
                <Image
                  key={p}
                  source={{ uri: exerciseImageUrl(p) }}
                  resizeMode="cover"
                  accessibilityLabel={`${name ?? 'Exercise'} ${shown.length === 1 ? 'photo' : i === 0 ? 'start position' : 'end position'}`}
                  style={[styles.photo, { borderRadius: radius.card }]}
                />
              ))}
            </View>
          ) : null}

          {!detail ? <Text style={text('body')}>Details aren’t available right now.</Text> : null}

          {muscles.length > 0 ? (
            <View style={[styles.tags, { gap: space[2] }]}>
              {muscles.map((m, i) => (
                <View
                  key={`${m}-${i}`}
                  style={[
                    styles.tag,
                    {
                      borderRadius: radius.pill,
                      paddingHorizontal: space[3],
                      paddingVertical: space[1],
                    },
                    i < (detail?.primaryMuscles.length ?? 0) ? styles.tagPrimary : styles.tagSecondary,
                  ]}
                >
                  <Text style={text('caption')}>{title(m)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {detail?.equipment ? <Text style={text('body')}>{`Equipment: ${title(detail.equipment)}`}</Text> : null}

          {detail && detail.instructions.length > 0 ? (
            <View style={{ gap: space[2] }}>
              <Text style={text('sectionHeading')} accessibilityRole="header">
                Instructions
              </Text>
              {detail.instructions.map((step, i) => (
                <View key={i} style={[styles.step, { gap: space[2] }]}>
                  <Text style={[text('body'), { minWidth: space[6] }]}>{`${i + 1}.`}</Text>
                  <Text style={[text('body'), styles.flex]}>{step}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {videoUrl ? (
            <Button
              testID="exercise-sheet-demo"
              variant="secondary"
              title="Watch demo"
              onPress={() => openDemo(videoUrl)}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  photo: {
    width: '100%',
    height: exercisePhotoHeight,
    backgroundColor: palette.surface,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: {},
  tagPrimary: { backgroundColor: palette.lime },
  tagSecondary: { backgroundColor: palette.surface },
  step: { flexDirection: 'row' },
  flex: { flex: 1 },
});
