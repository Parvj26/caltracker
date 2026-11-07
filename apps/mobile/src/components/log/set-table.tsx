import { memo, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type KeyboardTypeOptions,
} from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ActualPatch, StepField, Units } from '@caltracker/shared';
import { invalidAnnouncement, readTyped, type CellModel, type RowModel } from '@/lib/log-flow-model';
import { palette, pressedOpacity } from '@/theme/theme';
import { logMaxFontScale } from '@/theme/typography';
import { useTheme } from '@/theme/use-theme';

const KEYBOARD: Record<StepField, KeyboardTypeOptions> = {
  weight: 'decimal-pad',
  reps: 'number-pad',
  duration: 'numbers-and-punctuation',
  distance: 'decimal-pad',
};

const SPOKEN: Record<StepField, string> = { weight: 'weight', reps: 'reps', duration: 'time', distance: 'distance' };

/**
 * Numbers grow with the phone's text size up to this much; beyond it they would no longer fit their box. The cap was
 * 1.4 at the app's sizes: shared out over the logging pages' bigger text, the largest size in points stays the same.
 */
const MAX_FONT_SCALE = logMaxFontScale(1.4);

/** The bar above the number pad (iOS): number pads have no return key, so this is how the keyboard goes away. */
export const KEYBOARD_BAR_ID = 'log-number-pad';

/**
 * Rendered once and never again: redrawing an input accessory view makes iOS reload the keyboard's views, which
 * can drop the box's focus between two keystrokes (typing 140 saved 1).
 */
export const KeyboardBar = memo(function KeyboardBar() {
  const { logText: text, space } = useTheme();
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_BAR_ID}>
      <View style={[styles.bar, { paddingHorizontal: space[4] }]}>
        <Pressable
          testID="keyboard-done"
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel="Done typing"
          style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>Done typing</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
});

/** Said after a box or ✓ while the coach logs the workout (read only). */
const READ_ONLY_HINT = 'Read only. Your coach is logging this session.';

const DELETE_ACTIONS = [{ name: 'delete', label: 'Delete set' }];

export type TableHandlers = {
  /** A number typed in a box, already checked and turned into the stored patch. Saved on every readable keystroke. */
  onType: (row: RowModel, patch: ActualPatch) => void;
  /** ✓: ticks an open set with what the boxes show; unticks a ticked one. */
  onTick: (row: RowModel) => void;
  /** VoiceOver's "Delete set" action: removes the set straight away. */
  onDelete: (row: RowModel) => void;
  /** A long press on a row: the sheet with "Delete set". Only for a set that may be deleted. */
  onRowMenu: (row: RowModel) => void;
  /** The W / D / F tag: what it means. */
  onTag: (row: RowModel) => void;
};

/**
 * One number box. Keeps what is being typed and saves every number that can be stored. Something that can't (12.5
 * reps, 1:75, too heavy, or a blank on a ticked set) shows as invalid with a short reason, and the saved number
 * comes back when the box is left.
 */
function Cell({
  cell,
  row,
  who,
  units,
  testID,
  unitBelow,
  disabled,
  readOnly,
  onType,
}: {
  cell: CellModel;
  row: RowModel;
  who: string;
  units: Units;
  testID: string;
  unitBelow: boolean;
  disabled: boolean;
  readOnly: boolean;
  onType: (patch: ActualPatch) => void;
}) {
  const { logText: text, space, radius } = useTheme();
  const [draft, setDraft] = useState(cell.value);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) setDraft(cell.value);
  }, [cell.value, focused]);
  const label = `${who}${SPOKEN[cell.field]}${cell.field === 'reps' ? '' : ` in ${cell.unit}`}`;
  return (
    <View style={[styles.cell, { gap: space[1] / 2 }]}>
      <TextInput
        testID={testID}
        value={draft}
        editable={!disabled && !readOnly}
        accessibilityState={{ disabled: disabled || readOnly }}
        keyboardType={KEYBOARD[cell.field]}
        returnKeyType="done"
        inputAccessoryViewID={KEYBOARD_BAR_ID}
        selectTextOnFocus
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={label}
        accessibilityHint={invalid ?? (readOnly ? READ_ONLY_HINT : undefined)}
        placeholder={row.done || readOnly ? '' : cell.placeholder || '–'}
        placeholderTextColor={palette.inkMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setInvalid(null);
          setDraft(cell.value);
        }}
        onChangeText={(t) => {
          setDraft(t);
          const read = readTyped(cell.field, t, units, row.done);
          if (read.kind === 'invalid') {
            // accessibilityLiveRegion below is Android only: on iOS, VoiceOver is told the reason here, once.
            const say = invalidAnnouncement(invalid, read.message);
            if (say) AccessibilityInfo.announceForAccessibility(say);
            setInvalid(read.message);
            return;
          }
          setInvalid(null);
          onType(read.patch);
        }}
        style={[
          text('sectionHeading'),
          styles.input,
          { borderRadius: radius.input, paddingHorizontal: space[1] },
          row.done && styles.inputDone,
          readOnly && styles.inputReadOnly,
          focused && styles.inputFocused,
          invalid !== null && styles.inputInvalid,
        ]}
      />
      {invalid !== null ? (
        <Text testID={`invalid-${testID}`} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.invalidText]}>
          {invalid}
        </Text>
      ) : unitBelow ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.centre, row.done && styles.ink]}>
          {cell.unit}
        </Text>
      ) : null}
    </View>
  );
}

type RowProps = {
  row: RowModel;
  /** "<page>-<exercise>": test ids are `<what>-<idKey>-<setIndex>`. */
  idKey: string;
  /** Superset rows have no column headings, so each box says its unit. */
  unitBelow: boolean;
  /** "A2 Curl, ": the exercise, for screen readers, on a superset where rows of several exercises sit together. */
  exerciseLabel: string | null;
  units: Units;
  disabled?: boolean;
  /** The coach logs this workout: the row shows the coach's numbers and can't be changed. */
  readOnly?: boolean;
  /** The set the coach ticked last (read only): outlined so the client sees where the coach is. */
  recent?: boolean;
  handlers: TableHandlers;
};

/**
 * One set: tag, number boxes, ✓. Long-press the row (its tag or the space around the boxes) for "Delete set". There
 * is no swipe on a row: a sideways swipe always changes the page.
 */
function SetRowLineView({ row, idKey, unitBelow, exerciseLabel, units, disabled = false, readOnly = false, recent = false, handlers }: RowProps) {
  const { logText: text, space, radius } = useTheme();
  const indented = row.tagKind === 'drop' || row.tagKind === 'failure';
  const tagged = row.tagKind !== 'normal';
  const id = `${idKey}-${row.setIndex}`;
  const deletable = !disabled && !readOnly && row.deletable;
  const locked = disabled || readOnly;
  const setWords = row.name.charAt(0).toLowerCase() + row.name.slice(1);
  const who = `${exerciseLabel ? `${exerciseLabel}, ` : ''}${row.name}, `;
  const onAction = (e: AccessibilityActionEvent) => {
    if (deletable && e.nativeEvent.actionName === 'delete') handlers.onDelete(row);
  };
  return (
    // Not one element for VoiceOver (accessible false): the boxes and ✓ stay separate.
    <Pressable accessible={false} onLongPress={deletable ? () => handlers.onRowMenu(row) : undefined}>
      <View
        testID={`set-${id}`}
        accessibilityActions={deletable ? DELETE_ACTIONS : undefined}
        onAccessibilityAction={onAction}
        style={[
          styles.row,
          { gap: space[2], paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.input },
          indented && { marginLeft: space[4] },
          row.done && styles.rowDone,
          recent && styles.rowRecent,
        ]}
      >
        <Pressable
          testID={`tag-${id}`}
          disabled={!tagged && !deletable}
          onPress={tagged ? () => handlers.onTag(row) : undefined}
          onLongPress={deletable ? () => handlers.onRowMenu(row) : undefined}
          accessibilityActions={deletable ? DELETE_ACTIONS : undefined}
          onAccessibilityAction={onAction}
          accessibilityRole={tagged ? 'button' : 'text'}
          accessibilityLabel={tagged ? `${row.name}. What does ${row.tag} mean?` : row.name}
          style={({ pressed }) => [styles.tag, tagged && [styles.tagChip, { borderRadius: radius.pill }], pressed && styles.pressed]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('sectionHeading'), styles.ink]}>
            {row.tag}
          </Text>
        </Pressable>
        {row.cells.map((cell) => (
          <Cell
            key={cell.field}
            cell={cell}
            row={row}
            who={who}
            units={units}
            testID={`actual-${cell.field}-${id}`}
            unitBelow={unitBelow}
            disabled={disabled}
            readOnly={readOnly}
            onType={(patch) => handlers.onType(row, patch)}
          />
        ))}
        <Pressable
          testID={`tick-${id}`}
          disabled={locked}
          onPress={() => handlers.onTick(row)}
          hitSlop={4}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.done, disabled: locked }}
          accessibilityLabel={
            readOnly
              ? `${exerciseLabel ? `${exerciseLabel}, ` : ''}${setWords}${recent ? ', just ticked by your coach' : ''}`
              : `${row.done ? 'Untick' : 'Tick'} ${exerciseLabel ? `${exerciseLabel}, ` : ''}${setWords}`
          }
          accessibilityHint={readOnly ? READ_ONLY_HINT : undefined}
          style={({ pressed }) => [
            styles.tick,
            row.done ? styles.tickDone : styles.tickOpen,
            pressed && styles.pressed,
            // Read only keeps full colour (the coach's ticks must stay easy to read); an open one is dashed instead.
            readOnly ? !row.done && styles.tickReadOnly : disabled && styles.disabled,
          ]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('sectionHeading'), row.done ? styles.tickMarkDone : styles.tickMarkOpen]}>
            ✓
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const sameCells = (a: CellModel[], b: CellModel[]) =>
  a.length === b.length && a.every((c, i) => c.value === b[i].value && c.placeholder === b[i].placeholder && c.unit === b[i].unit);

/** Redraws a row only when what it shows changed (every edit builds new row objects for the whole page). */
export const SetRowLine = memo(
  SetRowLineView,
  (a, b) =>
    a.handlers === b.handlers &&
    a.idKey === b.idKey &&
    a.units === b.units &&
    a.disabled === b.disabled &&
    a.readOnly === b.readOnly &&
    a.recent === b.recent &&
    a.unitBelow === b.unitBelow &&
    a.exerciseLabel === b.exerciseLabel &&
    a.row.setId === b.row.setId &&
    a.row.setIndex === b.row.setIndex &&
    a.row.done === b.row.done &&
    a.row.tag === b.row.tag &&
    a.row.name === b.row.name &&
    a.row.deletable === b.row.deletable &&
    sameCells(a.row.cells, b.row.cells),
);

/** A straight exercise's sets: SET | LB | REPS | ✓ (columns follow the tracking type), then + Add set. */
export function SetTable({
  rows,
  idKey,
  units,
  disabled,
  readOnly = false,
  recentSetId = null,
  handlers,
  onAddSet,
}: {
  rows: RowModel[];
  idKey: string;
  units: Units;
  disabled?: boolean;
  readOnly?: boolean;
  recentSetId?: string | null;
  handlers: TableHandlers;
  onAddSet: (() => void) | null;
}) {
  const { logText: text, space, radius } = useTheme();
  const headings = rows[0]?.cells.map((c) => c.heading) ?? [];
  return (
    <View style={[styles.table, { borderRadius: radius.card, padding: space[2], gap: space[1] }]}>
      <View style={[styles.row, { gap: space[2], paddingHorizontal: space[2] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.tag, styles.headingText]}>
          SET
        </Text>
        {headings.map((h) => (
          <Text key={h} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.cell, styles.centre, styles.headingText]}>
            {h}
          </Text>
        ))}
        <View style={styles.tickSpace} />
      </View>
      {rows.map((row) => (
        <SetRowLine
          key={row.setId}
          row={row}
          idKey={idKey}
          unitBelow={false}
          exerciseLabel={null}
          units={units}
          disabled={disabled}
          readOnly={readOnly}
          recent={row.setId === recentSetId}
          handlers={handlers}
        />
      ))}
      {onAddSet ? <AddSetButton testID={`add-set-${idKey}`} onPress={onAddSet} /> : null}
    </View>
  );
}

export function AddSetButton({ testID, onPress, title = '+ Add set' }: { testID: string; onPress: () => void; title?: string }) {
  const { logText: text } = useTheme();
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
  rowRecent: { borderWidth: borderWidth.card * 2, borderColor: palette.ink },
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
  // Read only: no box to type in, just the number on the row (dashed, so it doesn't look tappable).
  inputReadOnly: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: palette.inkMuted },
  inputInvalid: { borderColor: palette.magentaDeep },
  invalidText: { color: palette.magentaDeep, textAlign: 'center' },
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
  tickReadOnly: { borderStyle: 'dashed', borderColor: palette.inkMuted },
  tickMarkOpen: { color: palette.border },
  tickMarkDone: { color: palette.lime },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: 0.4 },
  addSet: { minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  barButton: { minHeight: tapTarget.min, justifyContent: 'center', paddingHorizontal: 8 },
});
