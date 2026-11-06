import { useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LogBlockDoc, LogExerciseDoc, LogSetDoc, SetValues, Units } from '@caltracker/shared';
import { TextButton } from '@/components/ui';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { contentMaxWidth, palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ActionMenu, type MenuItem } from './action-menu';
import { ExerciseInfoSheet } from './exercise-info-sheet';
import { LogBlock, type BlockHandlers } from './log-block';
import { closeOpenSwipeRow } from './swipe-to-delete';

type Menu = { kind: 'exercise'; ex: LogExerciseDoc } | { kind: 'set'; ex: LogExerciseDoc; set: LogSetDoc; label: string };

/**
 * Edit sets: today's list for one page (all its exercises): ✓ to tick or untick, number boxes, swipe to delete,
 * the ⋯ set menu (+ Drop, Remove set), + Set and the exercise menu (Swap, Note, Remove exercise).
 * Menus and the info sheet open on top of this sheet. Swap and Note need a full sheet of their own, so this sheet
 * closes first and onSwap / onNote run once it has gone (iOS cannot present while a sheet is still closing).
 */
export function EditSetsSheet({
  visible,
  block,
  letter,
  firstExerciseIndex,
  units,
  details,
  lastTime,
  suggested,
  handlers,
  onClose,
  onSwap,
  onNote,
  onAddDrop,
  onRemoveExercise,
}: {
  visible: boolean;
  /** The page's block; null (e.g. just removed) shows nothing. */
  block: LogBlockDoc | null;
  /** The superset's letter, null for straight sets. */
  letter: string | null;
  /** Index of the block's first exercise across the log, for test ids (`set-{exercise}-{set}`). */
  firstExerciseIndex: number;
  units: Units;
  details: Record<string, ExerciseDetail>;
  lastTime: (ex: LogExerciseDoc) => string | null;
  /** What Done would save for an unticked set: grey placeholders in its empty boxes. */
  suggested: (setId: string) => SetValues | undefined;
  /** Tick, number boxes, swipe delete and + Set. The menus and info sheet are this sheet's own. */
  handlers: BlockHandlers;
  onClose: () => void;
  onSwap: (ex: LogExerciseDoc) => void;
  onNote: (ex: LogExerciseDoc) => void;
  onAddDrop: (ex: LogExerciseDoc, set: LogSetDoc) => void;
  /** Asks first (an alert), then removes. */
  onRemoveExercise: (ex: LogExerciseDoc) => void;
}) {
  const { text, space } = useTheme();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [infoFor, setInfoFor] = useState<LogExerciseDoc | null>(null);
  const pending = useRef<(() => void) | null>(null);

  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const closeThen = (action: () => void) => {
    pending.current = action;
    onClose();
    if (Platform.OS !== 'ios') runPending(); // onDismiss is iOS only
  };

  const sheetHandlers: BlockHandlers = {
    ...handlers,
    onSetMenu: (ex, set, label) => setMenu({ kind: 'set', ex, set, label }),
    onExerciseMenu: (ex) => setMenu({ kind: 'exercise', ex }),
    onExerciseInfo: (ex) => setInfoFor(ex),
  };

  const menuTitle =
    menu === null
      ? null
      : menu.kind === 'exercise'
        ? menu.ex.exerciseName
        : `${menu.ex.exerciseName} · ${menu.set.setType === 'drop' ? 'drop set' : menu.label === 'W' ? 'warm-up' : `set ${menu.label}`}`;

  const menuItems: MenuItem[] = (() => {
    if (menu === null) return [];
    if (menu.kind === 'exercise') {
      const ex = menu.ex;
      return [
        { title: 'Swap exercise', testID: 'menu-swap', onPress: () => closeThen(() => onSwap(ex)) },
        { title: ex.note ? 'Edit note' : 'Add note', testID: 'menu-note', onPress: () => closeThen(() => onNote(ex)) },
        { title: 'Remove exercise', testID: 'menu-remove-exercise', onPress: () => onRemoveExercise(ex) },
      ];
    }
    const { ex, set } = menu;
    const items: MenuItem[] = [];
    if (set.setType !== 'drop') items.push({ title: '+ Drop', testID: 'menu-add-drop', onPress: () => onAddDrop(ex, set) });
    items.push({ title: 'Remove set', testID: 'menu-remove-set', onPress: () => handlers.onRemoveSet(ex, set) });
    return items;
  })();

  return (
    <Modal
      visible={visible && block !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <SafeAreaView testID="edit-sets-sheet" style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.head, styles.column, { padding: space[4], paddingBottom: 0 }]}>
          <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
            Edit sets
          </Text>
          <TextButton testID="edit-sets-close" title="Close" onPress={onClose} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={closeOpenSwipeRow}
          contentContainerStyle={{ padding: space[4] }}
        >
          <View style={styles.column}>
            {block ? (
              <LogBlock
                block={block}
                letter={letter}
                firstExerciseIndex={firstExerciseIndex}
                units={units}
                lastTime={lastTime}
                details={details}
                handlers={sheetHandlers}
                suggested={(_ex, set) => (set.completedAt === null ? suggested(set.id) : undefined)}
              />
            ) : null}
          </View>
        </ScrollView>
        <ActionMenu title={menuTitle} items={menuItems} onClose={() => setMenu(null)} />
        <ExerciseInfoSheet
          name={infoFor?.exerciseName ?? null}
          detail={infoFor ? details[infoFor.exerciseId] : undefined}
          onClose={() => setInfoFor(null)}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
