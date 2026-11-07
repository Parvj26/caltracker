// The pages inside a section: a straight exercise, a superset (round by round) and a pick-one option.
// They only draw the page model (log-flow-model.ts); every edit goes back to the screen through the handlers.
import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type HostInstance } from 'react-native';
import type { Units } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import type { ExerciseModel, OptionPageModel, RowModel, StraightPageModel, SupersetPageModel } from '@/lib/log-flow-model';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ExerciseDemo, ExerciseTools } from './exercise-tools';
import { AddSetButton, SetRowLine, SetTable, type TableHandlers } from './set-table';

export type PageHandlers = {
  table: (ex: ExerciseModel) => TableHandlers;
  onAddSet: (ex: ExerciseModel) => void;
  onInfo: (ex: ExerciseModel) => void;
  onHistory: (ex: ExerciseModel) => void;
  onMessage: (ex: ExerciseModel) => void;
  onSwap: (ex: ExerciseModel) => void;
  /** "Which one are you doing?": the planned exercise or the coach's substitute. */
  onSubstitute: (ex: ExerciseModel) => void;
  onMore: (ex: ExerciseModel) => void;
};

type Common = {
  page: number;
  units: Units;
  details: Record<string, ExerciseDetail>;
  handlers: PageHandlers;
  /** The page's heading: VoiceOver moves here when the page comes on screen. */
  headingRef: Ref<HostInstance>;
  /** Mark all (or Mark all rounds); null hides it (everything ticked, or an option locked out). */
  onMarkAll: (() => void) | null;
};

/** Mark all sits at the end of the page, well away from Done. */
function MarkAll({ page, title, onPress }: { page: number; title: string; onPress: (() => void) | null }) {
  const { space } = useTheme();
  if (!onPress) return null;
  return (
    <View style={{ marginTop: space[2] }}>
      <Button variant="secondary" testID={`mark-all-${page}`} title={title} onPress={onPress} />
    </View>
  );
}

const keyOf = (page: number, ex: ExerciseModel) => `${page}-${ex.exerciseIndex}`;

/**
 * The coach's substitute: "Machine taken? Switch to X" before choosing; "Doing the substitute (planned: Y) · Switch"
 * after. Switching stays possible until a set is ticked.
 */
function SubstituteStrip({ ex, idKey, onPress }: { ex: ExerciseModel; idKey: string; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  const sub = ex.substitute;
  if (!sub || (sub.locked && sub.doingInsteadOf === null)) return null;
  const box = [text('body'), styles.strip, { borderRadius: radius.input, padding: space[3] }];
  if (sub.doingInsteadOf !== null) {
    return (
      <View testID={`substitute-doing-${idKey}`} style={[styles.doing, box]}>
        <Text style={[text('body'), styles.ink, styles.flex]}>{`Doing the substitute (planned: ${sub.doingInsteadOf})`}</Text>
        {sub.locked ? null : (
          <Pressable
            testID={`substitute-switch-${idKey}`}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel="Switch exercise"
            style={styles.switch}
          >
            <Text style={[text('sectionHeading'), styles.link]}>Switch</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <Text testID={`substitute-strip-${idKey}`} onPress={onPress} accessibilityRole="button" style={box}>
      <Text style={styles.bold}>Machine taken?</Text>
      {` Switch to ${sub.otherNames} ›`}
    </Text>
  );
}

function Notes({ ex, idKey }: { ex: ExerciseModel; idKey: string }) {
  const { text } = useTheme();
  return (
    <>
      {ex.restLine ? (
        <Text testID={`rest-line-${idKey}`} style={text('caption')}>
          {ex.restLine}
        </Text>
      ) : null}
      {ex.progression ? (
        <Text testID={`progression-${idKey}`} style={text('caption')} accessibilityLabel={`Auto progression: ${ex.progression}`}>
          {ex.progression}
        </Text>
      ) : null}
      {ex.note ? (
        <Text testID={`exercise-note-${idKey}`} style={text('body')}>
          {`Note: ${ex.note}`}
        </Text>
      ) : null}
    </>
  );
}

/** Big demo, name, tools, then the set table. Shared by a straight exercise and a pick-one option. */
function SingleExercise({
  page,
  ex,
  rows,
  disabled,
  units,
  details,
  handlers,
  headingRef,
  onMarkAll,
}: Common & { ex: ExerciseModel; rows: RowModel[]; disabled: boolean }) {
  const { text, space } = useTheme();
  const idKey = keyOf(page, ex);
  return (
    <View style={{ gap: space[3] }}>
      <ExerciseDemo name={ex.name} detail={details[ex.exerciseId]} size="big" testID={`demo-${idKey}`} onPress={() => handlers.onInfo(ex)} />
      <Text ref={headingRef} testID={`exercise-name-${page}`} style={text('screenTitle')} accessibilityRole="header">
        {ex.name}
      </Text>
      <Notes ex={ex} idKey={idKey} />
      <ExerciseTools
        idKey={idKey}
        name={ex.name}
        hasSubstitute={ex.substitute !== null && !ex.substitute.locked}
        onHistory={() => handlers.onHistory(ex)}
        onMessage={() => handlers.onMessage(ex)}
        onSwap={() => handlers.onSwap(ex)}
        onMore={() => handlers.onMore(ex)}
      />
      <SubstituteStrip ex={ex} idKey={idKey} onPress={() => handlers.onSubstitute(ex)} />
      <SetTable
        rows={rows}
        idKey={idKey}
        units={units}
        disabled={disabled}
        handlers={handlers.table(ex)}
        onAddSet={disabled ? null : () => handlers.onAddSet(ex)}
      />
      <MarkAll page={page} title="Mark all" onPress={onMarkAll} />
    </View>
  );
}

export function StraightPage({ model, ...common }: Common & { model: StraightPageModel }) {
  return <SingleExercise {...common} ex={model.exercise} rows={model.rows} disabled={false} />;
}

export function OptionPage({ model, ...common }: Common & { model: OptionPageModel }) {
  // The option line is the heading here (it says which option this is); the exercise name follows it.
  const { text, space, radius } = useTheme();
  return (
    <View style={{ gap: space[3] }}>
      <Text
        ref={common.headingRef}
        accessibilityRole="header"
        testID={`option-line-${common.page}`}
        style={[text('sectionHeading'), model.picked && [styles.pickedLine, { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] }]]}
      >
        {model.line}
      </Text>
      {model.lockedOut ? (
        <Text testID={`option-locked-${common.page}`} style={text('body')}>
          {model.lockedOut}
        </Text>
      ) : null}
      <SingleExercise {...common} headingRef={null} ex={model.exercise} rows={model.rows} disabled={model.lockedOut !== null} />
    </View>
  );
}

/** A superset: every round stacked, the current round with each exercise's photo and tools. */
export function SupersetPage({ model, page, units, details, handlers, headingRef, onMarkAll }: Common & { model: SupersetPageModel }) {
  const { text, space } = useTheme();
  return (
    <View style={{ gap: space[4] }}>
      <Text ref={headingRef} testID={`superset-heading-${page}`} style={[text('screenTitle'), styles.centre]} accessibilityRole="header">
        {model.heading}
      </Text>
      {model.rounds.map((round) => {
        const current = round.round === model.currentRound;
        return (
          <View key={round.round} testID={`round-${page}-${round.round}`} style={{ gap: space[3] }}>
            {/* Every round, the current one too, has the same heading under the superset's title. */}
            <View style={round.round > 1 && [styles.roundHead, { paddingTop: space[3] }]}>
              <Text
                testID={`round-heading-${page}-${round.round}`}
                style={[text('sectionHeading'), styles.centre]}
                accessibilityRole="header"
                accessibilityLabel={`${round.heading}${current && !round.done ? ', current round' : ''}`}
              >
                {round.heading}
              </Text>
            </View>
            {round.entries.map((entry) => {
              const ex = model.exercises[entry.exerciseIndex];
              const idKey = keyOf(page, ex);
              return (
                <View key={ex.logExerciseId} style={{ gap: space[2] }}>
                  {current ? (
                    <View style={[styles.exHead, { gap: space[3] }]}>
                      <ExerciseDemo name={ex.name} detail={details[ex.exerciseId]} size="medium" testID={`demo-${idKey}`} onPress={() => handlers.onInfo(ex)} />
                      <View style={[styles.flex, { gap: space[2] }]}>
                        <Text testID={`exercise-name-${idKey}`} style={text('sectionHeading')}>
                          {`${ex.label} · ${ex.name}`}
                        </Text>
                        <ExerciseTools
                          idKey={idKey}
                          name={ex.name}
                          hasSubstitute={ex.substitute !== null && !ex.substitute.locked}
                          onHistory={() => handlers.onHistory(ex)}
                          onMessage={null}
                          onSwap={() => handlers.onSwap(ex)}
                          onMore={() => handlers.onMore(ex)}
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={text('body')}>{`${ex.label} · ${ex.name}`}</Text>
                  )}
                  {current ? <Notes ex={{ ...ex, restLine: null }} idKey={idKey} /> : null}
                  {current ? <SubstituteStrip ex={ex} idKey={idKey} onPress={() => handlers.onSubstitute(ex)} /> : null}
                  {entry.rows.map((row) => (
                    <SetRowLine
                      key={row.setId}
                      row={row}
                      idKey={idKey}
                      unitBelow
                      exerciseLabel={`${ex.label ?? ''} ${ex.name}`.trim()}
                      units={units}
                      handlers={handlers.table(ex)}
                    />
                  ))}
                </View>
              );
            })}
            {round.restLine ? (
              <Text testID={`round-rest-${page}-${round.round}`} style={[text('caption'), styles.centre]}>
                {round.restLine}
              </Text>
            ) : null}
          </View>
        );
      })}
      <View style={{ gap: space[1] }}>
        {model.exercises.map((ex) => (
          <AddSetButton
            key={ex.logExerciseId}
            testID={`add-set-${keyOf(page, ex)}`}
            title={`+ Add set to ${ex.label ?? ex.name}`}
            onPress={() => handlers.onAddSet(ex)}
          />
        ))}
      </View>
      <MarkAll page={page} title="Mark all rounds" onPress={onMarkAll} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { textAlign: 'center' },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  exHead: { flexDirection: 'row', alignItems: 'center' },
  roundHead: { borderTopWidth: 1, borderTopColor: palette.border },
  strip: { backgroundColor: palette.tape, color: palette.ink, overflow: 'hidden' },
  doing: { flexDirection: 'row', alignItems: 'center' },
  ink: { color: palette.ink },
  link: { color: palette.ink, textDecorationLine: 'underline' },
  switch: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'flex-end', justifyContent: 'center' },
  pickedLine: { alignSelf: 'flex-start', backgroundColor: palette.lime, color: palette.ink, overflow: 'hidden' },
});
