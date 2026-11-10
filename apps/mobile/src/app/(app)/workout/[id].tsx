import { useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  exerciseBadges,
  formatRest,
  formatSetTarget,
  formatSetsSummary,
  sectionRuns,
  setLabels,
  workoutEquipment,
  type IsoDate,
  type Units,
  type WorkoutBlockDoc,
  type WorkoutDoc,
  type WorkoutExerciseDoc,
} from '@caltracker/shared';
import { ExerciseBadges } from '@/components/exercise-badges';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExerciseThumb } from '@/components/log/exercise-thumb';
import { Button, Card, ErrorText, Screen, TextButton } from '@/components/ui';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { openableDemoUrl } from '@/lib/demo-link';
import { openDemo } from '@/lib/open-demo';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { blockRounds, formatDayLabel, orList, supersetLetters } from '@/lib/workouts';
import { fetchMyUnits, fetchWorkoutDetail } from '@/lib/workouts-api';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type Detail = {
  doc: WorkoutDoc;
  scheduledOn: IsoDate;
  videoUrls: Record<string, string>;
  units: Units;
  /** Rounds per block, worked out while loading: a malformed workout then shows the error, not a crash. */
  rounds: number[];
};

/**
 * Read-only workout: what to bring, then blocks and exercises in the client's own units. Each exercise shows one
 * summary line of its sets and a set count (×N: warm-up and working sets; a drop continues the set before it, so
 * it is not counted); tapping the exercise shows each set with its rest and notes.
 */
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

  const exerciseIds = useMemo(
    () => (detail && detail !== 'missing' ? detail.doc.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)) : []),
    [detail],
  );
  const details = useExerciseDetails(exerciseIds);
  // Every exercise counts, pick-one options included: the client may choose any of them. Fills in as details load.
  const equipment = useMemo(() => workoutEquipment(exerciseIds.map((x) => details[x]?.equipment)), [exerciseIds, details]);
  const [infoFor, setInfoFor] = useState<WorkoutExerciseDoc | null>(null);

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
          {equipment.length > 0 ? <EquipmentRow names={equipment} /> : null}
          {detail.doc.notes ? <Text style={text('body')}>{detail.doc.notes}</Text> : null}
          {/* Blocks under their section headings; a workout without sections is one run with no heading. */}
          {sectionRuns(detail.doc.blocks, detail.doc.sections).map((run, r) => (
            <Fragment key={run.section?.id ?? `none-${r}`}>
              {run.section ? (
                <Text testID={`preview-section-${r}`} style={text('sectionHeading')} accessibilityRole="header">
                  {run.section.name}
                </Text>
              ) : null}
              {run.blockIndexes.map((i) => {
                const block = detail.doc.blocks[i];
                return block ? (
                  <BlockCard
                    key={block.id}
                    block={block}
                    letter={letters[i] ?? null}
                    rounds={detail.rounds[i] ?? 0}
                    units={detail.units}
                    videoUrls={detail.videoUrls}
                    details={details}
                    onInfo={setInfoFor}
                  />
                ) : null;
              })}
            </Fragment>
          ))}
        </>
      ) : null}

      <ExerciseInfoSheet
        name={infoFor?.exerciseName ?? null}
        detail={infoFor ? details[infoFor.exerciseId] : undefined}
        onClose={() => setInfoFor(null)}
      />
    </Screen>
  );
}

/** What to bring: one chip per piece of equipment, scrolling sideways when they don't fit. */
function EquipmentRow({ names }: { names: string[] }) {
  const { text, space, radius } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Text style={text('sectionHeading')} accessibilityRole="header">
        Equipment
      </Text>
      <ScrollView
        testID="preview-equipment"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space[2] }}
      >
        {names.map((name) => (
          <View
            key={name}
            style={[styles.chip, { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] }]}
          >
            <Text style={[text('body'), styles.inkText]}>{name}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function BlockCard({
  block,
  letter,
  rounds,
  units,
  videoUrls,
  details,
  onInfo,
}: {
  block: WorkoutBlockDoc;
  /** The superset's letter (A for the first superset, B for the second), null for straight sets. */
  letter: string | null;
  rounds: number;
  units: Units;
  videoUrls: Record<string, string>;
  details: Record<string, ExerciseDetail>;
  onInfo: (ex: WorkoutExerciseDoc) => void;
}) {
  const { text, space } = useTheme();
  const superset = block.kind === 'superset';
  const choice = block.kind === 'choice';
  return (
    <Card>
      {superset ? (
        <Text style={text('sectionHeading')} accessibilityRole="header">
          {`Superset / circuit · ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`}
        </Text>
      ) : null}
      {choice ? (
        <View style={{ gap: space[1] }}>
          <Text testID={`preview-pick-one-${block.id}`} style={text('sectionHeading')} accessibilityRole="header">
            Pick one
          </Text>
          <Text style={text('body')}>{orList(block.exercises.map((e) => e.exerciseName))}</Text>
        </View>
      ) : null}
      {block.exercises.map((ex, i) => (
        <View key={ex.id} style={{ gap: space[2] }}>
          {/* Between the options of a pick-one group. */}
          {choice && i > 0 ? (
            <Text style={[text('caption'), styles.centre]} accessibilityElementsHidden importantForAccessibility="no">
              or
            </Text>
          ) : null}
          <ExerciseSection
            exercise={ex}
            label={superset && letter ? `${letter}${i + 1}` : null}
            units={units}
            videoUrl={videoUrls[ex.exerciseId]}
            detail={details[ex.exerciseId]}
            onInfo={() => onInfo(ex)}
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
  detail,
  onInfo,
}: {
  exercise: WorkoutExerciseDoc;
  label: string | null;
  units: Units;
  videoUrl: string | undefined;
  detail: ExerciseDetail | undefined;
  onInfo: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const labels = setLabels(exercise.sets);
  const summary = formatSetsSummary(exercise.sets, exercise.trackingType, units);
  const setsWord = `${summary.count} ${summary.count === 1 ? 'set' : 'sets'}`;
  const badges = exerciseBadges(exercise);
  return (
    <View style={{ gap: space[2] }}>
      <View style={[styles.exerciseHeader, { gap: space[2] }]}>
        {label ? (
          <View style={[styles.letterChip, { borderRadius: radius.pill, paddingHorizontal: space[2] }]}>
            <Text style={text('sectionHeading')}>{label}</Text>
          </View>
        ) : null}
        {/* The photo opens the exercise info (and its demo); the rest of the row shows or hides each set. */}
        <ExerciseThumb
          name={exercise.exerciseName}
          detail={detail}
          testID={`preview-thumb-${exercise.id}`}
          onPress={onInfo}
        />
        {summary.count > 0 ? (
          <Pressable
            testID={`preview-expand-${exercise.id}`}
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${exercise.exerciseName}, ${setsWord}: ${summary.spoken}`}
            accessibilityHint={`${expanded ? 'Hides' : 'Shows'} each set. Exercise info is in the actions.`}
            // The photo is hidden from screen readers, so the info sheet (and its demo) is offered here instead.
            accessibilityActions={[{ name: 'info', label: 'Exercise info' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'info') onInfo();
            }}
            style={({ pressed }) => [styles.summaryRow, { gap: space[3] }, pressed && { opacity: pressedOpacity }]}
          >
            <View style={[styles.flex, { gap: space[1] }]}>
              <Text style={text('sectionHeading')}>{exercise.exerciseName}</Text>
              {/* Wraps onto more lines when long: every set stays readable, nothing is cut off. */}
              <Text testID={`preview-summary-${exercise.id}`} style={text('body')}>
                {summary.text}
              </Text>
            </View>
            <Text testID={`preview-count-${exercise.id}`} style={text('sectionHeading')}>
              {`×${summary.count}`}
            </Text>
          </Pressable>
        ) : (
          // No sets: nothing to show or hide, so the name opens the exercise info as on the logging screen.
          <Pressable
            testID={`preview-name-${exercise.id}`}
            onPress={onInfo}
            accessibilityRole="button"
            accessibilityHint="Opens exercise info"
            style={({ pressed }) => [styles.flex, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('sectionHeading')}>{exercise.exerciseName}</Text>
          </Pressable>
        )}
      </View>
      <ExerciseBadges badges={badges.badges} help={badges.help} testID={`preview-badges-${exercise.id}`} />
      {exercise.note ? <Text style={text('body')}>{exercise.note}</Text> : null}

      {expanded && summary.count > 0
        ? exercise.sets.map((set, i) => {
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
                  accessibilityLabel={
                    labels[i] === 'F' ? (drop ? 'Drop set to failure' : 'Set to failure') : drop ? 'Drop set' : labels[i] === 'W' ? 'Warm-up' : `Set ${labels[i]}`
                  }
                >
                  {labels[i]}
                </Text>
                <View style={[styles.flex, { gap: space[1] }]}>
                  {/* Text on the drop pastel is always ink, never muted. */}
                  <Text style={[text('body'), drop && styles.inkText]}>
                    {formatSetTarget(set, exercise.trackingType, units)}
                  </Text>
                  {rest ? <Text style={[text('caption'), drop && styles.inkText]}>{rest}</Text> : null}
                  {set.note ? <Text style={[text('caption'), drop && styles.inkText]}>{set.note}</Text> : null}
                </View>
              </View>
            );
          })
        : null}

      {openableDemoUrl(videoUrl) ? (
        <Button
          variant="secondary"
          title="Watch form on YouTube"
          onPress={() => openDemo(videoUrl)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: { alignItems: 'flex-start' },
  // No wrapping: the summary takes the room beside the photo and grows downwards when long.
  exerciseHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  letterChip: { backgroundColor: palette.lime },
  chip: { backgroundColor: palette.surface },
  summaryRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  setRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: palette.surface },
  // Drop rows sit indented on the drop pastel (text stays ink, never muted, on a pastel).
  dropRow: { backgroundColor: palette.drop },
  setLabel: { minWidth: 24 },
  inkText: { color: palette.ink },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },
});
