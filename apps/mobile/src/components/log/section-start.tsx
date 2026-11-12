// The "Start section" page and the workout overview. Both list exercises the same way: photo, name, the coach's
// targets in one line, ×N, and "⇄ or: X" when the coach added a substitute.
import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import { Button, TextButton } from '@/components/ui';
import { logControls } from '@/lib/coach-watch';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import type { FlowSection, StartGroup, StartItem } from '@/lib/log-flow-model';
import { contentMaxWidth, palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ExerciseThumb } from './exercise-thumb';

function ItemRow({ item, details, onInfo }: { item: StartItem; details: Record<string, ExerciseDetail>; onInfo: (item: StartItem) => void }) {
  const { text, space } = useTheme();
  return (
    <View
      testID={`start-item-${item.logExerciseId}`}
      accessible
      accessibilityLabel={`${item.name}, ${item.count.replace('×', '')} ${item.count === '×1' ? 'set' : 'sets'}: ${item.summary}${item.substitute ? `. ${item.substitute.replace('or:', 'Or')}` : ''}${item.done ? '. Done' : ''}`}
      accessibilityActions={[{ name: 'activate', label: 'Exercise info' }]}
      onAccessibilityAction={() => onInfo(item)}
      style={[styles.item, { gap: space[3] }]}
    >
      <ExerciseThumb name={item.name} detail={details[item.exerciseId]} testID={`start-thumb-${item.logExerciseId}`} onPress={() => onInfo(item)} />
      <View style={[styles.flex, { gap: space[1] / 2 }]}>
        <Text style={text('sectionHeading')}>{`${item.name}${item.done ? ' ✓' : ''}`}</Text>
        <Text style={text('caption')}>{item.summary}</Text>
        {item.substitute ? (
          <Text testID={`start-substitute-${item.logExerciseId}`} style={[text('caption'), styles.ink]}>
            {`⇄ ${item.substitute}`}
          </Text>
        ) : null}
      </View>
      <Text style={text('sectionHeading')}>{item.count}</Text>
    </View>
  );
}

/** A section's exercises: supersets and pick-one groups framed, with "or" between the options. */
export function StartList({
  groups,
  details,
  onInfo,
}: {
  groups: StartGroup[];
  details: Record<string, ExerciseDetail>;
  onInfo: (item: StartItem) => void;
}) {
  const { text, space, radius } = useTheme();
  return (
    <View style={{ gap: space[3] }}>
      {groups.map((g) =>
        g.kind === 'straight' ? (
          <ItemRow key={g.key} item={g.item} details={details} onInfo={onInfo} />
        ) : (
          <View key={g.key} style={[styles.group, { borderRadius: radius.card, padding: space[3], gap: space[2] }]}>
            {g.kind === 'superset' ? (
              <Text style={[text('caption'), styles.label]} accessibilityRole="header">
                SUPERSET
              </Text>
            ) : null}
            {g.items.map((item, i) => (
              <Fragment key={item.logExerciseId}>
                {g.kind === 'choice' && i > 0 ? (
                  <Text style={[text('caption'), styles.centre]} accessibilityElementsHidden importantForAccessibility="no">
                    or
                  </Text>
                ) : null}
                <ItemRow item={item} details={details} onInfo={onInfo} />
              </Fragment>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

/** "Section 2 of 4", the name, how much is in it, Start section, then the list. */
export function SectionStart({
  section,
  index,
  of,
  groups,
  details,
  started,
  onStart,
  onBack,
  onInfo,
  onAddExercise,
  readOnly = false,
}: {
  section: FlowSection;
  index: number;
  of: number;
  groups: StartGroup[];
  details: Record<string, ExerciseDetail>;
  /** Something in the section is ticked: the button says Continue. */
  started: boolean;
  onStart: () => void;
  onBack: () => void;
  onInfo: (item: StartItem) => void;
  onAddExercise: () => void;
  /** The coach logs this workout: no adding; Start only opens the pages to look. */
  readOnly?: boolean;
}) {
  const { text, space } = useTheme();
  const insets = useSafeAreaInsets();
  const empty = section.pages.length === 0;
  const can = logControls(readOnly);
  return (
    <ScrollView testID="section-start" contentContainerStyle={[styles.content, { padding: space[4], paddingBottom: space[6] + insets.bottom }]}>
      <View style={[styles.column, { gap: space[4] }]}>
        <View style={styles.backRow}>
          <Pressable
            testID="section-back"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to workout"
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('screenTitle')}>⌄</Text>
          </Pressable>
        </View>
        <View style={{ gap: space[1] }}>
          {of > 1 ? (
            <Text testID="section-place" style={text('caption')}>{`Section ${index + 1} of ${of}`}</Text>
          ) : null}
          <Text testID="section-title" style={[text('screenTitle'), styles.title]} accessibilityRole="header">
            {section.title}
          </Text>
          <Text testID="section-count" style={text('body')}>
            {section.countLine}
          </Text>
        </View>
        {empty ? (
          <View style={{ gap: space[3] }}>
            <Text style={text('body')}>{can.addExercise ? 'Add your first exercise to start logging.' : 'Nothing in this section yet.'}</Text>
            {can.addExercise ? <Button title="+ Add exercise" testID="add-exercise" onPress={onAddExercise} /> : null}
          </View>
        ) : (
          <>
            <Button
              title={readOnly ? 'View section' : started ? 'Continue section' : 'Start section'}
              testID="start-section"
              onPress={onStart}
            />
            <StartList groups={groups} details={details} onInfo={onInfo} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

export type OverviewSection = { section: FlowSection; groups: StartGroup[] };

/** Inside the log: the whole workout, its sections (tap one to start it), add, finish and discard. */
export function WorkoutOverview({
  name,
  started,
  sections,
  equipment,
  details,
  onStart,
  onSection,
  onClose,
  onInfo,
  onAddExercise,
  onFinish,
  onDiscard,
  readOnly = false,
}: {
  name: string;
  /** A set is ticked: the button says Continue. */
  started: boolean;
  sections: OverviewSection[];
  equipment: string[];
  details: Record<string, ExerciseDetail>;
  onStart: () => void;
  onSection: (index: number) => void;
  onClose: () => void;
  onInfo: (item: StartItem) => void;
  onAddExercise: () => void;
  onFinish: () => void;
  onDiscard: () => void;
  /** The coach logs this workout: no add, finish or discard; the button only opens the pages to look. */
  readOnly?: boolean;
}) {
  const { text, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const can = logControls(readOnly);
  return (
    <ScrollView testID="workout-overview" contentContainerStyle={{ paddingBottom: space[6] + insets.bottom }}>
      <View style={[styles.hero, { paddingTop: insets.top + space[2], padding: space[4], gap: space[2] }]}>
        <View style={[styles.column, { gap: space[2] }]}>
          <Pressable
            testID="overview-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back to Today. The workout keeps going."
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('screenTitle'), styles.onInk]}>✕</Text>
          </Pressable>
          <Text style={[text('caption'), styles.onInk]}>{readOnly ? 'Logged by your coach' : started ? 'Workout in progress' : 'Today’s workout'}</Text>
          <Text testID="overview-name" style={[text('screenTitle'), styles.onInk, styles.title]} accessibilityRole="header">
            {name}
          </Text>
          <View style={[styles.heroButton, { borderRadius: radius.pill, marginTop: space[2] }]}>
            <Pressable
              testID="start-workout"
              onPress={onStart}
              accessibilityRole="button"
              style={({ pressed }) => [styles.startPill, { borderRadius: radius.pill, paddingHorizontal: space[6] }, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={[text('button'), styles.ink]}>{readOnly ? 'View sets' : started ? 'Continue' : 'Start workout'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <View style={[styles.column, { padding: space[4], gap: space[4] }]}>
        {equipment.length > 0 ? (
          <View testID="overview-equipment" style={[styles.chips, { gap: space[2] }]} accessibilityLabel={`Equipment: ${equipment.join(', ')}`}>
            {equipment.map((e) => (
              <Text key={e} style={[text('caption'), styles.chip, styles.ink, { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] }]}>
                {e}
              </Text>
            ))}
          </View>
        ) : null}
        {sections.map(({ section, groups }, i) => (
          <View key={section.key} style={{ gap: space[2] }}>
            <Pressable
              testID={`overview-section-${i}`}
              onPress={() => onSection(i)}
              accessibilityRole="button"
              accessibilityLabel={`${section.title}, ${section.countLine}${section.done ? ', done' : ''}. Opens the section.`}
              style={({ pressed }) => [styles.sectionHead, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={[text('sectionHeading'), styles.flex]}>{`${section.title}${section.done ? ' ✓' : ''}`}</Text>
              <Text style={text('sectionHeading')}>›</Text>
            </Pressable>
            {groups.length > 0 ? <StartList groups={groups} details={details} onInfo={onInfo} /> : null}
          </View>
        ))}
        {can.addExercise ? <Button variant="secondary" title="+ Add exercise" testID="add-exercise" onPress={onAddExercise} /> : null}
        {can.finish ? <Button variant="finish" title="Finish workout" testID="finish-workout" ph-label="log_finish_workout" onPress={onFinish} /> : null}
        {can.discard ? <TextButton testID="discard-workout" title="Discard workout" onPress={onDiscard} /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center' },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  backRow: { alignItems: 'flex-start' },
  iconButton: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'flex-start', justifyContent: 'center' },
  title: { fontSize: 30, lineHeight: 36 },
  item: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  group: { backgroundColor: palette.surface },
  label: { letterSpacing: 0.8 },
  centre: { textAlign: 'center' },
  ink: { color: palette.ink },
  onInk: { color: white },
  hero: { backgroundColor: palette.ink },
  heroButton: { alignSelf: 'flex-start' },
  startPill: { minHeight: tapTarget.logging, justifyContent: 'center', backgroundColor: white },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: palette.surface, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget.min },
});
