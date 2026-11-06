import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { DoneButton } from './done-button';
import { ExerciseThumb } from './exercise-thumb';
import { ActionRow, AllDoneCard, MoveRow, PillButton, SetHeading, StepperRow, UpNext, type PageProps } from './page-parts';
import { StepList } from './step-list';

const CHIP_FILL = { done: palette.ink, current: palette.magenta, todo: palette.border } as const;

/** A superset: "SUPERSET · Round 2 of 3" header, one card per exercise (active one open), Done, round chips. */
export function SupersetPage({
  model,
  page,
  resting,
  handlers,
  prevName,
  nextName,
  details,
}: PageProps & { details: Record<string, ExerciseDetail> }) {
  const { text, space, radius } = useTheme();
  const { current, round } = model;
  const labels = model.exercises.map((e) => e.label);
  const activeIndex = model.exercises.find((e) => e.active)?.exerciseIndex ?? 0;

  const header = round ? (
    <Text testID={`superset-header-${page}`} style={text('caption')} accessibilityRole="header">
      {['SUPERSET', `Round ${round.current} of ${round.total}`, round.restText].filter((p) => p).join(' · ')}
    </Text>
  ) : (
    <Text style={text('caption')} accessibilityRole="header">SUPERSET</Text>
  );

  if (resting) {
    return (
      <View style={{ gap: space[3] }}>
        <Text testID={`exercise-name-${page}`} style={text('sectionHeading')}>
          {model.exercises.map((e) => `${e.label ?? ''} ${e.name}`.trim()).join(' + ')}
        </Text>
        <StepList steps={model.steps} page={page} showWarmupNote={model.hasWarmups} heading="THIS EXERCISE" labels={labels} />
        {/* Only the photos, steppers and Done wait for the rest; editing and moving stay at hand. */}
        <ActionRow
          page={page}
          onEditSets={handlers.onEditSets}
          onNote={() => handlers.onNote(activeIndex)}
          onSwap={() => handlers.onSwap(activeIndex)}
        />
        <MoveRow page={page} prevName={prevName} nextName={nextName} onPrev={handlers.onPrev} onNext={handlers.onNext} />
      </View>
    );
  }

  return (
    <View style={{ gap: space[3] }}>
      {header}
      {model.exercises.map((ex, k) => {
        const open = ex.active && current !== null && !model.allDone;
        const common = { testID: `superset-ex-${page}-${k}` };
        if (!open) {
          return (
            <Pressable
              key={ex.logExerciseId}
              {...common}
              onPress={() => handlers.onFocusExercise(k)}
              accessibilityRole="button"
              accessibilityLabel={`${ex.label ?? ''} ${ex.name}${ex.collapsedText ? `, ${ex.collapsedText}` : ''}`}
              style={({ pressed }) => [
                styles.card,
                styles.collapsed,
                { borderRadius: radius.card, padding: space[3], gap: space[2] },
                pressed && { opacity: pressedOpacity },
              ]}
            >
              {ex.label ? (
                <View style={[styles.letter, { borderRadius: radius.pill }]}>
                  <Text style={text('sectionHeading')}>{ex.label}</Text>
                </View>
              ) : null}
              <Text style={[text('body'), styles.flex, styles.ink]} numberOfLines={1}>{ex.name}</Text>
              {ex.collapsedText ? <Text style={[text('caption'), styles.ink]}>{ex.collapsedText}</Text> : null}
            </Pressable>
          );
        }
        return (
          <View
            key={ex.logExerciseId}
            {...common}
            style={[styles.card, styles.open, { borderRadius: radius.card, padding: space[3], gap: space[3] }]}
          >
            <View style={[styles.head, { gap: space[2] }]}>
              {ex.label ? (
                <View style={[styles.letter, { borderRadius: radius.pill }]}>
                  <Text style={text('sectionHeading')}>{ex.label}</Text>
                </View>
              ) : null}
              <ExerciseThumb
                name={ex.name}
                detail={details[ex.exerciseId]}
                testID={`thumb-${page}-${k}`}
                onPress={() => handlers.onHowTo(k)}
              />
              <Pressable
                testID={`exercise-name-${page}`}
                onPress={() => handlers.onHowTo(k)}
                accessibilityRole="button"
                accessibilityHint="Opens exercise info"
                style={[styles.flex, styles.name]}
              >
                <Text style={text('sectionHeading')}>{ex.name}</Text>
              </Pressable>
              <PillButton testID={`how-to-${page}`} title="How to" label={`How to do ${ex.name}`} onPress={() => handlers.onHowTo(k)} />
            </View>
            {ex.reference ? <Text style={text('caption')}>{ex.reference}</Text> : null}
            {ex.swapped ? <Text style={text('caption')}>Swapped in for this workout</Text> : null}
            {ex.note ? <Text style={text('body')}>{ex.note}</Text> : null}
            <SetHeading current={current} drop={current.dropSteps !== null} page={page} />
            {current.dropSteps ? (
              <>
                <StepList
                  steps={current.dropSteps}
                  page={page}
                  showWarmupNote={false}
                  renderCurrent={() => <StepperRow current={current} page={page} handlers={handlers} />}
                />
                <PillButton testID={`add-drop-${page}`} title="+ Add another drop" onPress={handlers.onAddDrop} />
              </>
            ) : (
              <StepperRow current={current} page={page} handlers={handlers} />
            )}
          </View>
        );
      })}

      {model.allDone || !current ? (
        <>
          <AllDoneCard page={page} hasNext={model.upNext !== null} onNext={handlers.onNext} onFinish={handlers.onFinish} />
          <StepList steps={model.steps} page={page} showWarmupNote={model.hasWarmups} labels={labels} />
        </>
      ) : (
        <DoneButton label={current.doneLabel} page={page} onPress={handlers.onDone} />
      )}

      {round && !model.allDone ? (
        <View style={{ gap: space[1] }}>
          <View testID={`round-chips-${page}`} style={[styles.chips, { gap: space[2] }]} accessible accessibilityLabel={`Rounds: ${round.chips.map((c, i) => `${i + 1} ${c}`).join(', ')}`}>
            <Text style={text('caption')}>Rounds</Text>
            {round.chips.map((c, i) => (
              <View key={i} style={[styles.roundChip, { backgroundColor: CHIP_FILL[c], borderRadius: radius.pill }]}>
                <Text style={[text('caption'), { color: c === 'todo' ? palette.ink : palette.bg }]}>{i + 1}</Text>
              </View>
            ))}
          </View>
          {round.afterRound ? <Text style={text('caption')}>After this round: {round.afterRound}</Text> : null}
        </View>
      ) : null}

      <ActionRow
        page={page}
        onEditSets={handlers.onEditSets}
        onNote={() => handlers.onNote(activeIndex)}
        onSwap={() => handlers.onSwap(activeIndex)}
      />
      <MoveRow page={page} prevName={prevName} nextName={nextName} onPrev={handlers.onPrev} onNext={handlers.onNext} />
      <UpNext page={page} text={model.upNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: borderWidth.card },
  collapsed: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget.min, backgroundColor: palette.surface, borderColor: palette.border },
  open: { borderColor: palette.ink, backgroundColor: palette.bg },
  head: { flexDirection: 'row', alignItems: 'center' },
  name: { minHeight: tapTarget.min, justifyContent: 'center' },
  letter: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.lime },
  flex: { flex: 1 },
  ink: { color: palette.ink },
  chips: { flexDirection: 'row', alignItems: 'center' },
  roundChip: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
