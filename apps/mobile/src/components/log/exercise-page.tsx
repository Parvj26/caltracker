import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { tapTarget } from '@caltracker/design-tokens';
import { useTheme } from '@/theme/use-theme';
import { DoneButton } from './done-button';
import { ExercisePhoto } from './exercise-photo';
import { ActionRow, AllDoneCard, MoveRow, PillButton, SetHeading, StepperRow, UpNext, type PageProps } from './page-parts';
import { StepList } from './step-list';

export type { PageHandlers, PageProps } from './page-parts';

/**
 * One straight exercise: photo, name, set heading, steppers, Done, actions, move row and Up next.
 * While resting: the name, the step list, actions and the move row.
 */
export function ExercisePage({ model, page, resting, handlers, prevName, nextName, detail }: PageProps & { detail: ExerciseDetail | undefined }) {
  const { text, space } = useTheme();
  const ex = model.exercises[0];
  const current = model.current;

  if (resting) {
    return (
      <View style={{ gap: space[3] }}>
        <Text testID={`exercise-name-${page}`} style={text('sectionHeading')}>{ex.name}</Text>
        <StepList steps={model.steps} page={page} showWarmupNote={model.hasWarmups} heading="THIS EXERCISE" />
        {/* Only the photo, steppers and Done wait for the rest; editing and moving stay at hand. */}
        <ActionRow
          page={page}
          onEditSets={handlers.onEditSets}
          onNote={() => handlers.onNote(0)}
          onSwap={() => handlers.onSwap(0)}
        />
        <MoveRow page={page} prevName={prevName} nextName={nextName} onPrev={handlers.onPrev} onNext={handlers.onNext} />
      </View>
    );
  }

  const header = (
    <>
      <Pressable
        testID={`exercise-name-${page}`}
        onPress={() => handlers.onHowTo(0)}
        accessibilityRole="button"
        accessibilityHint="Opens exercise info"
        accessibilityLabel={ex.name}
        style={styles.nameButton}
      >
        <Text style={text('screenTitle')}>{ex.name}</Text>
      </Pressable>
      {ex.reference ? <Text testID={`reference-${page}`} style={text('caption')}>{ex.reference}</Text> : null}
      {ex.swapped ? <Text style={text('caption')}>Swapped in for this workout</Text> : null}
      {ex.note ? <Text style={text('body')}>{ex.note}</Text> : null}
    </>
  );

  return (
    <View style={{ gap: space[3] }}>
      <ExercisePhoto detail={detail} name={ex.name} page={page} onHowTo={() => handlers.onHowTo(0)} />
      <View style={{ gap: space[1] }}>{header}</View>

      {model.allDone || !current ? (
        <>
          <AllDoneCard page={page} hasNext={model.upNext !== null && !model.workoutDone} onNext={handlers.onNext} onFinish={handlers.onFinish} />
          <StepList steps={model.steps} page={page} showWarmupNote={model.hasWarmups} />
        </>
      ) : (
        <>
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
          <DoneButton label={current.doneLabel} page={page} onPress={handlers.onDone} />
        </>
      )}

      <ActionRow
        page={page}
        onEditSets={handlers.onEditSets}
        onNote={() => handlers.onNote(0)}
        onSwap={() => handlers.onSwap(0)}
      />
      <MoveRow page={page} prevName={prevName} nextName={nextName} onPrev={handlers.onPrev} onNext={handlers.onNext} />
      <UpNext page={page} text={model.workoutDone ? null : model.upNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  nameButton: { minHeight: tapTarget.min, justifyContent: 'center' },
});
