import { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextButton } from '@/components/ui';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export type ExerciseListRow = { title: string; detail: string; done: boolean };

/**
 * The exercise list (opened from the "2 of 5" pill): one row per page, a ✓ on finished ones; tapping a row jumps
 * there. At the bottom: + Add exercise and Discard workout. Every choice closes the sheet first and runs once it has
 * gone, because iOS cannot show the picker or an alert while this sheet is still closing.
 */
export function ExerciseListSheet({
  visible,
  rows,
  current,
  onPick,
  onAdd,
  onDiscard,
  onClose,
}: {
  visible: boolean;
  rows: ExerciseListRow[];
  /** The page on screen, marked in the list. */
  current: number;
  onPick: (index: number) => void;
  onAdd: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  const pending = useRef<(() => void) | null>(null);
  // A choice left over from a close whose dismiss never came must not run when the sheet next closes.
  useEffect(() => {
    if (visible) pending.current = null;
  }, [visible]);
  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const choose = (action: () => void) => {
    pending.current = action;
    onClose();
    if (Platform.OS !== 'ios') runPending(); // onDismiss is iOS only
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: space[4] }}>
          <View testID="exercise-list" style={[styles.column, { gap: space[3] }]}>
            <View style={styles.head}>
              <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
                Exercises
              </Text>
              <TextButton testID="exercise-list-close" title="Close" onPress={onClose} />
            </View>
            {rows.map((row, i) => (
              <Pressable
                key={i}
                testID={`exercise-row-${i}`}
                onPress={() => choose(() => onPick(i))}
                accessibilityRole="button"
                accessibilityState={{ selected: i === current }}
                accessibilityLabel={`${row.title}, ${row.detail}${row.done ? ', done' : ''}${i === current ? ', on screen' : ''}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderRadius: radius.card,
                    padding: space[3],
                    gap: space[3],
                    borderColor: i === current ? palette.ink : palette.border,
                  },
                  row.done && styles.doneRow,
                  pressed && { opacity: pressedOpacity },
                ]}
              >
                <View style={[styles.flex, { gap: space[1] }]}>
                  <Text style={[text('body'), styles.ink]}>{row.title}</Text>
                  <Text style={[text('caption'), styles.ink]}>{row.detail}</Text>
                </View>
                {row.done ? <Text style={[text('sectionHeading'), styles.ink]}>✓</Text> : null}
              </Pressable>
            ))}
            <Button
              variant="secondary"
              title="+ Add exercise"
              testID="list-add-exercise"
              onPress={() => choose(onAdd)}
            />
            <TextButton testID="discard-button" title="Discard workout" onPress={() => choose(onDiscard)} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  ink: { color: palette.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tapTarget.min,
    borderWidth: borderWidth.card,
    backgroundColor: palette.bg,
  },
  doneRow: { backgroundColor: palette.lime },
});
