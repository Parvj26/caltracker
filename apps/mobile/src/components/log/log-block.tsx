import { Text, View } from 'react-native';
import { setLabels, type ActualPatch, type LogBlockDoc, type LogExerciseDoc, type LogSetDoc, type Units } from '@caltracker/shared';
import { Card, TextButton } from '@/components/ui';
import { useTheme } from '@/theme/use-theme';
import { ExerciseHeader } from './exercise-header';
import { SetRow } from './set-row';

export type BlockHandlers = {
  onTick: (ex: LogExerciseDoc, set: LogSetDoc) => void;
  onChange: (set: LogSetDoc, patch: ActualPatch) => void;
  onSetMenu: (ex: LogExerciseDoc, set: LogSetDoc, label: string) => void;
  onExerciseMenu: (ex: LogExerciseDoc) => void;
  onAddSet: (ex: LogExerciseDoc) => void;
};

/** One block of the log as a card: a straight exercise, or a superset's exercises labelled A1, A2… */
export function LogBlock({
  block,
  letter,
  firstExerciseIndex,
  units,
  lastTime,
  handlers,
}: {
  block: LogBlockDoc;
  /** The superset's letter, null for straight sets. */
  letter: string | null;
  /** Index of this block's first exercise across the whole log, for test ids. */
  firstExerciseIndex: number;
  units: Units;
  lastTime: (ex: LogExerciseDoc) => string | null;
  handlers: BlockHandlers;
}) {
  const { text, space } = useTheme();
  const superset = block.kind === 'superset';
  return (
    <Card>
      {superset ? (
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Superset / circuit
        </Text>
      ) : null}
      {block.exercises.map((ex, i) => {
        const ei = firstExerciseIndex + i;
        const labels = setLabels(ex.sets);
        return (
          <View key={ex.id} style={{ gap: space[2] }}>
            <ExerciseHeader
              name={ex.exerciseName}
              label={superset && letter ? `${letter}${i + 1}` : null}
              note={ex.note}
              lastTime={lastTime(ex)}
              swapped={ex.swappedFromExerciseId !== null}
              menuTestID={`exercise-menu-${ei}`}
              onMenu={() => handlers.onExerciseMenu(ex)}
            />
            {ex.sets.map((set, si) => (
              <SetRow
                key={set.id}
                set={set}
                label={labels[si] ?? ''}
                trackingType={ex.trackingType}
                units={units}
                index={`${ei}-${si}`}
                onTick={() => handlers.onTick(ex, set)}
                onChange={(patch) => handlers.onChange(set, patch)}
                onMenu={() => handlers.onSetMenu(ex, set, labels[si] ?? '')}
              />
            ))}
            <TextButton testID={`add-set-${ei}`} title="+ Set" onPress={() => handlers.onAddSet(ex)} />
          </View>
        );
      })}
    </Card>
  );
}
