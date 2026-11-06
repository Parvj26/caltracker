import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { StepField } from '@caltracker/shared';
import { parseActualInput } from '@/lib/active-log-logic';
import type { CellModel, RowModel } from '@/lib/log-flow-model';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { SwipeToDelete } from './swipe-to-delete';

const KEYBOARD: Record<StepField, KeyboardTypeOptions> = {
  weight: 'decimal-pad',
  reps: 'number-pad',
  duration: 'numbers-and-punctuation',
  distance: 'decimal-pad',
};

const SPOKEN: Record<StepField, string> = { weight: 'weight', reps: 'reps', duration: 'time', distance: 'distance' };

export type TableHandlers = {
  /** A number typed in the box's own unit (null when cleared). Saved on every readable keystroke. */
  onType: (row: RowModel, field: StepField, typed: number | null) => void;
  /** ✓: ticks an open set with what the boxes show; unticks a ticked one. */
  onTick: (row: RowModel) => void;
  onDelete: (row: RowModel) => void;
  /** False for the only set of an exercise (the shared rule refuses removing it). */
  canDelete: (row: RowModel) => boolean;
  /** The W / D / F tag: what it means. */
  onTag: (row: RowModel) => void;
};

/** One number box. Keeps what is being typed; shows the stored value again once it loses focus. */
function Cell({
  cell,
  row,
  testID,
  unitBelow,
  disabled,
  onType,
}: {
  cell: CellModel;
  row: RowModel;
  testID: string;
  unitBelow: boolean;
  disabled: boolean;
  onType: (typed: number | null) => void;
}) {
  const { text, space, radius } = useTheme();
  const [draft, setDraft] = useState(cell.value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(cell.value);
  }, [cell.value, focused]);
  return (
    <View style={[styles.cell, { gap: space[1] / 2 }]}>
      <TextInput
        testID={testID}
        value={draft}
        editable={!disabled}
        keyboardType={KEYBOARD[cell.field]}
        returnKeyType="done"
        selectTextOnFocus
        accessibilityLabel={`${row.name} ${SPOKEN[cell.field]}${cell.field === 'reps' ? '' : ` in ${cell.unit}`}`}
        placeholder={cell.placeholder || '–'}
        placeholderTextColor={palette.inkMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDraft(cell.value);
        }}
        onChangeText={(t) => {
          setDraft(t);
          const v = parseActualInput(t, cell.field);
          if (v !== undefined) onType(v);
        }}
        style={[
          text('sectionHeading'),
          styles.input,
          { borderRadius: radius.input, paddingHorizontal: space[1] },
          row.done && styles.inputDone,
          focused && styles.inputFocused,
        ]}
      />
      {unitBelow ? <Text style={[text('caption'), styles.centre, row.done && styles.ink]}>{cell.unit}</Text> : null}
    </View>
  );
}

/** One set: tag, number boxes, ✓. Swipe left to delete. */
export function SetRowLine({
  row,
  idKey,
  unitBelow,
  disabled = false,
  handlers,
}: {
  row: RowModel;
  /** "<page>-<exercise>": test ids are `<what>-<idKey>-<setIndex>`. */
  idKey: string;
  /** Superset rows have no column headings, so each box says its unit. */
  unitBelow: boolean;
  disabled?: boolean;
  handlers: TableHandlers;
}) {
  const { text, space, radius } = useTheme();
  const indented = row.tagKind === 'drop' || row.tagKind === 'failure';
  const tagged = row.tagKind !== 'normal';
  const id = `${idKey}-${row.setIndex}`;
  const deletable = !disabled && handlers.canDelete(row);
  return (
    <SwipeToDelete testID={`set-delete-${id}`} label={`Delete ${row.name.toLowerCase()}`} onDelete={() => handlers.onDelete(row)} enabled={deletable}>
      <View
        testID={`set-${id}`}
        accessibilityActions={deletable ? [{ name: 'delete', label: `Delete ${row.name.toLowerCase()}` }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'delete') handlers.onDelete(row);
        }}
        style={[
          styles.row,
          { gap: space[2], paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.input },
          indented && { marginLeft: space[4] },
          row.done && styles.rowDone,
        ]}
      >
        <Pressable
          testID={`tag-${id}`}
          disabled={!tagged}
          onPress={() => handlers.onTag(row)}
          accessibilityRole={tagged ? 'button' : 'text'}
          accessibilityLabel={tagged ? `${row.name}. What does ${row.tag} mean?` : row.name}
          style={({ pressed }) => [styles.tag, tagged && [styles.tagChip, { borderRadius: radius.pill }], pressed && styles.pressed]}
        >
          <Text style={[text('sectionHeading'), styles.ink]}>{row.tag}</Text>
        </Pressable>
        {row.cells.map((cell) => (
          <Cell
            key={cell.field}
            cell={cell}
            row={row}
            testID={`actual-${cell.field}-${id}`}
            unitBelow={unitBelow}
            disabled={disabled}
            onType={(v) => handlers.onType(row, cell.field, v)}
          />
        ))}
        <Pressable
          testID={`tick-${id}`}
          disabled={disabled}
          onPress={() => handlers.onTick(row)}
          hitSlop={4}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.done, disabled }}
          accessibilityLabel={`${row.name} done`}
          style={({ pressed }) => [styles.tick, row.done ? styles.tickDone : styles.tickOpen, pressed && styles.pressed, disabled && styles.disabled]}
        >
          <Text style={[text('sectionHeading'), row.done ? styles.tickMarkDone : styles.tickMarkOpen]}>✓</Text>
        </Pressable>
      </View>
    </SwipeToDelete>
  );
}

/** A straight exercise's sets: SET | LB | REPS | ✓ (columns follow the tracking type), then + Add set. */
export function SetTable({
  rows,
  idKey,
  disabled,
  handlers,
  onAddSet,
}: {
  rows: RowModel[];
  idKey: string;
  disabled?: boolean;
  handlers: TableHandlers;
  onAddSet: (() => void) | null;
}) {
  const { text, space, radius } = useTheme();
  const headings = rows[0]?.cells.map((c) => c.heading) ?? [];
  return (
    <View style={[styles.table, { borderRadius: radius.card, padding: space[2], gap: space[1] }]}>
      <View style={[styles.row, { gap: space[2], paddingHorizontal: space[2] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={[text('caption'), styles.tag, styles.headingText]}>SET</Text>
        {headings.map((h) => (
          <Text key={h} style={[text('caption'), styles.cell, styles.centre, styles.headingText]}>
            {h}
          </Text>
        ))}
        <View style={styles.tickSpace} />
      </View>
      {rows.map((row) => (
        <SetRowLine key={row.setId} row={row} idKey={idKey} unitBelow={false} disabled={disabled} handlers={handlers} />
      ))}
      {onAddSet ? <AddSetButton testID={`add-set-${idKey}`} onPress={onAddSet} /> : null}
    </View>
  );
}

export function AddSetButton({ testID, onPress, title = '+ Add set' }: { testID: string; onPress: () => void; title?: string }) {
  const { text } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title.replace(/^\+ /, '')}
      style={({ pressed }) => [styles.addSet, pressed && styles.pressed]}
    >
      <Text style={text('sectionHeading')}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  table: { backgroundColor: palette.surface },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowDone: { backgroundColor: palette.lime },
  tag: { width: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  tagChip: { backgroundColor: palette.drop },
  headingText: { minHeight: 0, letterSpacing: 0.6 },
  cell: { flex: 1 },
  input: {
    minHeight: tapTarget.min,
    backgroundColor: palette.bg,
    borderWidth: borderWidth.card,
    borderColor: palette.border,
    textAlign: 'center',
  },
  inputDone: { borderColor: palette.lime },
  inputFocused: { borderColor: palette.ink },
  centre: { textAlign: 'center' },
  ink: { color: palette.ink },
  tick: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
  },
  tickSpace: { width: tapTarget.min },
  tickOpen: { backgroundColor: palette.bg, borderColor: palette.ink },
  tickDone: { backgroundColor: palette.ink, borderColor: palette.ink },
  tickMarkOpen: { color: palette.border },
  tickMarkDone: { color: palette.lime },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: 0.4 },
  addSet: { minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
});
