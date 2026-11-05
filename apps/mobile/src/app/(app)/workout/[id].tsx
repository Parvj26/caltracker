import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import {
  formatRest,
  formatSetTarget,
  setLabels,
  type IsoDate,
  type Units,
  type WorkoutBlockDoc,
  type WorkoutDoc,
  type WorkoutExerciseDoc,
} from '@caltracker/shared';
import { Button, Card, ErrorText, Screen, TextButton } from '@/components/ui';
import { blockRounds, formatDayLabel, supersetLetters } from '@/lib/workouts';
import { fetchMyUnits, fetchWorkoutDetail } from '@/lib/workouts-api';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type Detail = {
  doc: WorkoutDoc;
  scheduledOn: IsoDate;
  videoUrls: Record<string, string>;
  units: Units;
  /** Rounds per block, worked out while loading: a malformed workout then shows the error, not a crash. */
  rounds: number[];
};

/** Read-only workout: blocks, exercises and set targets in the client's own units. No logging in phase 2. */
export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { text, space } = useTheme();
  const [detail, setDetail] = useState<Detail | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [found, units] = await Promise.all([fetchWorkoutDetail(id ?? ''), fetchMyUnits()]);
      setDetail(found ? { ...found, units, rounds: blockRounds(found.doc.blocks) } : 'missing');
    } catch {
      // workouts-api logs the detail; the client only ever sees plain words. blockRounds also lands here if a
      // drop set ever arrives with no set before it.
      setError('Something went wrong. Try again.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const letters = detail && detail !== 'missing' ? supersetLetters(detail.doc.blocks) : [];
  const back = () => (router.canGoBack() ? router.back() : router.replace('/today'));

  return (
    <Screen>
      <View style={styles.backRow}>
        <TextButton testID="back" title="Back" onPress={back} />
      </View>

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => void load()} />
        </Card>
      ) : null}

      {detail === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}

      {detail === 'missing' ? (
        <Card>
          <Text style={text('sectionHeading')}>This workout isn't on your calendar any more.</Text>
        </Card>
      ) : null}

      {detail && detail !== 'missing' ? (
        <>
          <View style={{ gap: space[1] }}>
            <Text style={text('screenTitle')} accessibilityRole="header">
              {detail.doc.name}
            </Text>
            <Text style={text('body')}>{formatDayLabel(detail.scheduledOn)}</Text>
          </View>
          {detail.doc.notes ? <Text style={text('body')}>{detail.doc.notes}</Text> : null}
          {detail.doc.blocks.map((block, i) => (
            <BlockCard
              key={block.id}
              block={block}
              letter={letters[i] ?? null}
              rounds={detail.rounds[i] ?? 0}
              units={detail.units}
              videoUrls={detail.videoUrls}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function BlockCard({
  block,
  letter,
  rounds,
  units,
  videoUrls,
}: {
  block: WorkoutBlockDoc;
  /** The superset's letter (A for the first superset, B for the second), null for straight sets. */
  letter: string | null;
  rounds: number;
  units: Units;
  videoUrls: Record<string, string>;
}) {
  const { text, space } = useTheme();
  const superset = block.kind === 'superset';
  return (
    <Card>
      {superset ? (
        <Text style={text('sectionHeading')} accessibilityRole="header">
          {`Superset / circuit · ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`}
        </Text>
      ) : null}
      {block.exercises.map((ex, i) => (
        <View key={ex.id} style={{ gap: space[2] }}>
          <ExerciseSection
            exercise={ex}
            label={superset && letter ? `${letter}${i + 1}` : null}
            units={units}
            videoUrl={videoUrls[ex.exerciseId]}
          />
        </View>
      ))}
    </Card>
  );
}

function ExerciseSection({
  exercise,
  label,
  units,
  videoUrl,
}: {
  exercise: WorkoutExerciseDoc;
  label: string | null;
  units: Units;
  videoUrl: string | undefined;
}) {
  const { text, space, radius } = useTheme();
  const labels = setLabels(exercise.sets);
  return (
    <View style={{ gap: space[2] }}>
      <View style={[styles.exerciseHeader, { gap: space[2] }]}>
        {label ? (
          <View style={[styles.letterChip, { borderRadius: radius.pill, paddingHorizontal: space[2] }]}>
            <Text style={text('sectionHeading')}>{label}</Text>
          </View>
        ) : null}
        <Text style={[text('sectionHeading'), styles.flex]} accessibilityRole="header">
          {exercise.exerciseName}
        </Text>
      </View>
      {exercise.note ? <Text style={text('body')}>{exercise.note}</Text> : null}

      {exercise.sets.map((set, i) => {
        const drop = set.setType === 'drop';
        const rest = formatRest(set.restSeconds);
        return (
          <View
            key={set.id}
            testID={drop ? 'drop-set' : undefined}
            style={[
              styles.setRow,
              { gap: space[3], paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.input },
              drop && [styles.dropRow, { marginLeft: space[6] }],
            ]}
          >
            <Text
              style={[text('sectionHeading'), styles.setLabel, drop && styles.inkText]}
              accessibilityLabel={drop ? 'Drop set' : labels[i] === 'W' ? 'Warm-up' : `Set ${labels[i]}`}
            >
              {labels[i]}
            </Text>
            <View style={[styles.flex, { gap: space[1] }]}>
              {/* Text on the drop pastel is always ink, never muted. */}
              <Text style={[text('body'), drop && styles.inkText]}>{formatSetTarget(set, exercise.trackingType, units)}</Text>
              {rest ? <Text style={[text('caption'), drop && styles.inkText]}>{rest}</Text> : null}
              {set.note ? <Text style={[text('caption'), drop && styles.inkText]}>{set.note}</Text> : null}
            </View>
          </View>
        );
      })}

      {videoUrl ? (
        <Button
          variant="secondary"
          title="Watch form on YouTube"
          onPress={() => void Linking.openURL(videoUrl).catch(() => undefined)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: { alignItems: 'flex-start' },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  letterChip: { backgroundColor: palette.lime },
  setRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: palette.surface },
  // Drop rows sit indented on the drop pastel (text stays ink, never muted, on a pastel).
  dropRow: { backgroundColor: palette.drop },
  setLabel: { minWidth: 24 },
  inkText: { color: palette.ink },
  flex: { flex: 1 },
});
