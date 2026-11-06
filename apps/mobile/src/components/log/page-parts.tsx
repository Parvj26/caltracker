// Pieces shared by the straight and superset pages. Presentational only: everything shown comes from the page model.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { PageModel, StepperModel } from '@/lib/log-page-model';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Stepper } from './stepper';

export type PageHandlers = {
  onStep: (field: StepperModel['field'], dir: -1 | 1) => void;
  /** The typed value in stored units (kg, reps, seconds, metres), or null when cleared. */
  onType: (field: StepperModel['field'], value: number | null) => void;
  onDone: () => void;
  onEditSets: () => void;
  onNote: (exerciseIndex: number) => void;
  onSwap: (exerciseIndex: number) => void;
  onHowTo: (exerciseIndex: number) => void;
  onAddDrop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onFocusExercise: (exerciseIndex: number) => void;
  onFinish: () => void;
};

export type PageProps = {
  model: PageModel;
  page: number;
  resting: boolean;
  handlers: PageHandlers;
  /** Names of the neighbouring pages for the move row (null at the ends). */
  prevName: string | null;
  nextName: string | null;
};

/*
 * testIDs for Maestro (p = page index, k = exercise index on a superset page):
 *   done-{p}  stepper-{weight|reps|duration|distance}-{minus|value|plus}-{p}  step-name-{p}  body-tile-{p}
 *   edit-sets-{p}  note-{p}  swap-{p}  prev-{p}  next-{p}  up-next-{p}  add-drop-{p}
 *   all-done-{p} with next-exercise-{p} or finish-all-{p}
 * (photo-{p}, how-to-{p}, exercise-name-{p}, step-row-{p}-{exerciseIndex}-{setIndex}, superset-ex-{p}-{k} live in their own files.)
 */
type Current = NonNullable<PageModel['current']>;

const DOT = { done: palette.ink, current: palette.magenta, todo: palette.border, 'warmup-done': palette.inkMuted, 'warmup-todo': palette.surface } as const;

/** "Set 2 of 3" with its dots; W chip on warm-ups; DROP SET chip and note when the set has drops. */
export function SetHeading({ current, drop, page }: { current: Current; drop: boolean; page: number }) {
  const { text, space, radius } = useTheme();
  const warmup = current.step.kind === 'warmup';
  return (
    <View style={{ gap: space[1] }}>
      <View style={[styles.row, { gap: space[2] }]}>
        {warmup ? (
          <View style={[styles.chip, { backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: space[2] }]}>
            <Text style={[text('sectionHeading'), styles.ink]}>W</Text>
          </View>
        ) : null}
        <Text testID={`step-name-${page}`} style={[text('sectionHeading'), styles.flex]} accessibilityRole="header">
          {current.setName}
        </Text>
        {drop ? (
          <View style={[styles.chip, { backgroundColor: palette.drop, borderRadius: radius.pill, paddingHorizontal: space[2] }]}>
            <Text style={[text('caption'), styles.ink]}>DROP SET</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.row, { gap: space[1] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {current.dots.map((d, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: DOT[d] }]} />
        ))}
      </View>
      {drop ? <Text style={text('caption')}>No rest between drops</Text> : null}
    </View>
  );
}

/** The steppers side by side; reps-only exercises get a Body tile where weight would be. */
export function StepperRow({ current, page, handlers }: { current: Current; page: number; handlers: PageHandlers }) {
  const { text, space, radius } = useTheme();
  return (
    <View style={[styles.row, { gap: space[3], alignItems: 'flex-start' }]}>
      {current.bodyTile ? (
        <View testID={`body-tile-${page}`} accessible accessibilityLabel="Bodyweight" style={[styles.body, { borderRadius: radius.input, padding: space[3] }]}>
          <Text style={[text('sectionHeading'), styles.ink]}>Body</Text>
        </View>
      ) : null}
      {current.steppers.map((s) => (
        <Stepper
          key={s.field}
          model={s}
          page={page}
          onStep={(d) => handlers.onStep(s.field, d)}
          onType={(v) => handlers.onType(s.field, v)}
          setName={current.setName}
        />
      ))}
    </View>
  );
}

export function PillButton({ testID, title, label, onPress }: { testID: string; title: string; label?: string; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      style={({ pressed }) => [
        styles.pill,
        { borderRadius: radius.button, paddingHorizontal: space[3] },
        pressed && { opacity: pressedOpacity },
      ]}
    >
      <Text style={[text('button'), styles.ink]}>{title}</Text>
    </Pressable>
  );
}

/** Edit sets · Note · Swap. */
export function ActionRow({ page, onEditSets, onNote, onSwap }: { page: number; onEditSets: () => void; onNote: () => void; onSwap: () => void }) {
  const { space } = useTheme();
  return (
    <View style={[styles.row, { gap: space[2] }]}>
      <PillButton testID={`edit-sets-${page}`} title="Edit sets" onPress={onEditSets} />
      <PillButton testID={`note-${page}`} title="Note" onPress={onNote} />
      <PillButton testID={`swap-${page}`} title="Swap" onPress={onSwap} />
    </View>
  );
}

/** ‹ previous name · swipe to move · next name ›. Each side hides at the ends. */
export function MoveRow({ page, prevName, nextName, onPrev, onNext }: { page: number; prevName: string | null; nextName: string | null; onPrev: () => void; onNext: () => void }) {
  const { text, space } = useTheme();
  return (
    <View style={[styles.row, { gap: space[2] }]}>
      <View style={styles.flex}>
        {prevName ? (
          <Pressable testID={`prev-${page}`} onPress={onPrev} accessibilityRole="button" accessibilityLabel={`Previous exercise, ${prevName}`} style={styles.move}>
            <Text style={[text('caption'), styles.ink]} numberOfLines={1}>
              ‹ {prevName}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={text('caption')} accessibilityElementsHidden importantForAccessibility="no">
        swipe to move
      </Text>
      <View style={[styles.flex, { alignItems: 'flex-end' }]}>
        {nextName ? (
          <Pressable testID={`next-${page}`} onPress={onNext} accessibilityRole="button" accessibilityLabel={`Next exercise, ${nextName}`} style={styles.move}>
            <Text style={[text('caption'), styles.ink]} numberOfLines={1}>
              {nextName} ›
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function UpNext({ page, text: line }: { page: number; text: string | null }) {
  const { text, space, radius } = useTheme();
  if (!line) return null;
  return (
    <View testID={`up-next-${page}`} accessible style={[styles.upNext, { borderRadius: radius.card, padding: space[3], gap: space[1] }]}>
      <Text style={text('caption')}>UP NEXT</Text>
      <Text style={[text('body'), styles.ink]}>{line}</Text>
    </View>
  );
}

/** "All sets done ✓" with Next exercise › (or Finish workout when nothing follows). */
export function AllDoneCard({ page, hasNext, onNext, onFinish }: { page: number; hasNext: boolean; onNext: () => void; onFinish: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <View testID={`all-done-${page}`} style={[styles.allDone, { borderRadius: radius.card, padding: space[4], gap: space[3] }]}>
      <Text style={[text('screenTitle'), styles.ink]} accessibilityRole="header">
        All sets done ✓
      </Text>
      {hasNext ? (
        <PillButton testID={`next-exercise-${page}`} title="Next exercise ›" onPress={onNext} />
      ) : (
        <PillButton testID={`finish-all-${page}`} title="Finish workout" onPress={onFinish} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  ink: { color: palette.ink },
  chip: { minHeight: 24, justifyContent: 'center', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { backgroundColor: palette.surface, minHeight: tapTarget.logging, justifyContent: 'center', alignItems: 'center' },
  pill: {
    flex: 1,
    minHeight: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
  move: { minHeight: tapTarget.min, justifyContent: 'center', maxWidth: '100%' },
  upNext: { backgroundColor: palette.surface },
  allDone: { backgroundColor: palette.lime },
});
