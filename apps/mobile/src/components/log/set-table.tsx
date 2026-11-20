import { createContext, memo, useContext, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type KeyboardTypeOptions,
} from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ActualPatch, StepField, Units } from '@caltracker/shared';
import { ChevronIcon } from '@/components/ui/icons';
import { invalidAnnouncement, readTyped, type CellModel, type RowModel } from '@/lib/log-flow-model';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { logMaxFontScale } from '@/theme/typography';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';

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

/**
 * The number boxes of the open workout, in page order, so the bar above the number pad can move between them (‹ ›).
 * One per logging screen (FieldNavContext). Each box registers itself with its page and its place on the page.
 */
type Measure = (done: (top: number, height: number) => void) => void;

export class FieldNav {
  private fields = new Map<string, { page: number; order: number; focus: () => void; measure: Measure }>();
  /** A box asked for before it exists (a drop set just added): focused as soon as it registers. */
  private pending: string | null = null;
  private scrollers = new Map<number, (dy: number) => void>();
  private current: string | null = null;
  private listeners = new Set<() => void>();
  /** Where the keyboard's top is in the window while it is up (the bar sits just above it), else null. */
  private keyboardTop: number | null = null;

  register(key: string, page: number, order: number, focus: () => void, measure: Measure, alias?: string): () => void {
    this.fields.set(key, { page, order, focus, measure });
    if (alias !== undefined && alias === this.pending) {
      this.pending = null;
      // After the menu sheet has gone, or iOS won't raise the keyboard.
      setTimeout(focus, FOCUS_AFTER_MS);
    }
    return () => {
      if (this.fields.get(key)?.focus === focus) this.fields.delete(key);
    };
  }
  /** Puts the cursor in a set's box once it is on screen ("<setId>:<field>"), e.g. a new drop set's reps. */
  focusWhenReady(alias: string): void {
    this.pending = alias;
  }
  /** A page's scroll view, so a box hidden behind the bar can be scrolled into view. */
  registerScroller(page: number, scrollBy: (dy: number) => void): () => void {
    this.scrollers.set(page, scrollBy);
    return () => {
      if (this.scrollers.get(page) === scrollBy) this.scrollers.delete(page);
    };
  }
  keyboardAt(top: number | null): void {
    this.keyboardTop = top;
    this.reveal();
  }
  focused(key: string | null): void {
    if (this.current === key) return;
    this.current = key;
    this.listeners.forEach((l) => l());
    this.reveal();
  }
  /**
   * Keeps the focused box clear of the bar: after iOS has scrolled it above the keyboard (which doesn't count the
   * bar), scroll on by whatever the bar still covers.
   */
  private reveal(): void {
    const key = this.current;
    const top = this.keyboardTop;
    const field = key ? this.fields.get(key) : undefined;
    if (!field || top === null) return;
    setTimeout(() => {
      field.measure((y, h) => {
        // The bar's top: the keyboard's top, moved down onto iOS 26's Done row when there is one.
        const limit = top + SYSTEM_DONE_ROW - KEYBOARD_BAR_HEIGHT - REVEAL_GAP;
        if (this.current === key && y + h > limit) this.scrollers.get(field.page)?.(y + h - limit);
      });
    }, REVEAL_AFTER_MS);
  }
  blurred(key: string): void {
    if (this.current === key) this.focused(null);
  }
  /** The box after (+1) or before (-1) the focused one on the same page, or null at either end. */
  neighbour(delta: -1 | 1): (() => void) | null {
    const here = this.current ? this.fields.get(this.current) : undefined;
    if (!here) return null;
    const same = [...this.fields.values()].filter((f) => f.page === here.page).sort((a, b) => a.order - b.order);
    const i = same.findIndex((f) => f.order === here.order);
    return same[i + delta]?.focus ?? null;
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  snapshot = () => this.current;
}

export const FieldNavContext = createContext<FieldNav | null>(null);

/** iOS 26 puts its own Done above a number pad: the bar then only adds ‹ › (one Done, not two). */
const SYSTEM_DONE = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

/**
 * iOS 26's Done floats in a clear row at the top of the keyboard's frame, above the keys. The bar sits down in that
 * row, so ‹ › and Done share one line (approved Logger board) instead of Done hanging under the bar. Measured on the
 * iOS 26 simulator: the row is 50 pt.
 */
const SYSTEM_DONE_ROW = SYSTEM_DONE ? 50 : 0;

/** A new box gets the cursor this long after it appears (the menu sheet closes first). */
const FOCUS_AFTER_MS = 350;

/** Height of the bar above the number pad. */
export const KEYBOARD_BAR_HEIGHT = 56;
/** Space kept between a focused box and the bar: the rest of its row (padding, the outline) and a margin. */
const REVEAL_GAP = 20;
/** Lets iOS's own scroll (above the keyboard) settle before checking the bar. */
const REVEAL_AFTER_MS = 120;

/**
 * The ‹ › Done bar above the number pad (iOS number pads have no return key). Rendered once per logging screen and
 * drawn by the app itself just above the keyboard, NOT as an InputAccessoryView: in the new architecture an
 * InputAccessoryView attaches only to the first matching box on screen when it mounts (RCTInputAccessoryComponentView
 * didMoveToWindow), so the shared bar never showed on the other boxes, and redrawing one drops the box's focus.
 * ‹ › move focus between the page's boxes through their refs; Done closes the keyboard.
 */
export const KeyboardBar = memo(function KeyboardBar({ nav }: { nav: FieldNav }) {
  const { logText: text, space, radius } = useTheme();
  const win = useWindowDimensions();
  const screen = Dimensions.get('screen');
  // The keyboard's frame is in screen points: only a full-screen app (not iPad Split View or Stage Manager) can place
  // the bar against it. Otherwise there is no bar; the keyboard's own hide key still closes it.
  const fullScreen = Math.round(win.width) === Math.round(screen.width) && Math.round(win.height) === Math.round(screen.height);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  // Where the logging screen's bottom edge is in the window (the bar is drawn inside it).
  const layer = useRef<ComponentRef<typeof View>>(null);
  const [layerBottom, setLayerBottom] = useState<number | null>(null);
  const current = useSyncExternalStore(nav.subscribe, nav.snapshot);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      setKeyboardTop(e.endCoordinates.screenY);
      nav.keyboardAt(e.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardTop(null);
      nav.keyboardAt(null);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [nav]);
  const measure = () => layer.current?.measureInWindow((_x, y, _w, h) => setLayerBottom(y + h));
  const show =
    Platform.OS === 'ios' && fullScreen && keyboardTop !== null && layerBottom !== null && keyboardTop < layerBottom && current !== null;
  const prev = show ? nav.neighbour(-1) : null;
  const next = show ? nav.neighbour(1) : null;
  return (
    <View ref={layer} onLayout={measure} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {show && layerBottom !== null && keyboardTop !== null ? (
    <View testID="keyboard-bar" style={[styles.bar, { bottom: layerBottom - keyboardTop - SYSTEM_DONE_ROW, paddingHorizontal: space[2.5] }]}>
      <Pressable
        testID="keyboard-prev"
        onPress={() => prev?.()}
        disabled={!prev}
        accessibilityRole="button"
        accessibilityLabel="Previous box"
        accessibilityState={{ disabled: !prev }}
        style={({ pressed }) => [styles.barArrow, !prev && styles.barOff, pressed && styles.pressed]}
      >
        <ChevronIcon direction="left" size={22} />
      </Pressable>
      <Pressable
        testID="keyboard-next"
        onPress={() => next?.()}
        disabled={!next}
        accessibilityRole="button"
        accessibilityLabel="Next box"
        accessibilityState={{ disabled: !next }}
        style={({ pressed }) => [styles.barArrow, !next && styles.barOff, pressed && styles.pressed]}
      >
        <ChevronIcon direction="right" size={22} />
      </Pressable>
      <View style={styles.flex} />
      {SYSTEM_DONE ? null : (
      <Pressable
        testID="keyboard-done"
        onPress={() => Keyboard.dismiss()}
        accessibilityRole="button"
        accessibilityLabel="Done typing"
        style={({ pressed }) => [styles.barDone, { borderRadius: radius.pill, paddingHorizontal: space[4.5] }, pressed && styles.pressed]}
      >
        <Text style={[text('sectionHeading'), styles.onInk]}>Done</Text>
      </Pressable>
      )}
    </View>
      ) : null}
    </View>
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
  /** The row's ··· or a long press: the set menu (Add drop set, Delete set). Only for a set that has either. */
  onRowMenu: (row: RowModel) => void;
  /** The W / D / F tag: what it means. */
  onTag: (row: RowModel) => void;
};

/**
 * One number box. Keeps what is being typed and saves every number that can be stored. Something that can't (12.5
 * reps, 1:75, too heavy, or a blank on a ticked set) shows as invalid with a short reason, and the saved number
 * comes back when the box is left.
 */
/** What the short word hints in an empty box mean, for screen readers. */
const WORD_HINTS: Record<string, string> = {
  max: 'As many reps as you can, to failure.',
  '+ unit': 'Weight added to your body, optional.',
};

/** A pre-fill that is a number the box can hold ("60", "1:30"), not a word hint like "max". */
const NUMERIC = /^[\d.,:]+$/;

function Cell({
  cell,
  row,
  who,
  units,
  testID,
  unitMode,
  faded,
  fit,
  disabled,
  readOnly,
  nav,
  onType,
}: {
  cell: CellModel;
  row: RowModel;
  who: string;
  units: Units;
  testID: string;
  /** 'none': the column heading says it; 'auto': inside the box when it fits, else under it (large text). */
  unitMode: 'none' | 'auto';
  /** A round still to come: its suggested number is fainter. */
  faded: boolean;
  /** The row's longest number and unit: every box of a row puts its unit inside, or every box under. */
  fit: { value: string; unit: string };
  disabled: boolean;
  readOnly: boolean;
  /** Its page and place on the page, for ‹ › on the keyboard bar. */
  nav: { page: number; order: number } | null;
  onType: (patch: ActualPatch) => void;
}) {
  const { logText: text, space, radius } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [boxWidth, setBoxWidth] = useState(0);
  const [draft, setDraft] = useState(cell.value);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  /** The stored value when the box was focused: what an unreadable draft goes back to (nothing half-typed is kept). */
  const atFocus = useRef(cell.value);
  const restoreFocusValue = () => {
    if (cell.value === atFocus.current) return;
    const back = readTyped(cell.field, atFocus.current, units, row.done);
    if (back.kind === 'ok') onType(back.patch);
  };
  const fields = useContext(FieldNavContext);
  const editable = !disabled && !readOnly;
  useEffect(() => {
    if (!focused) setDraft(cell.value);
  }, [cell.value, focused]);
  useEffect(() => {
    if (!fields || !nav || !editable) return;
    return fields.register(
      testID,
      nav.page,
      nav.order,
      () => input.current?.focus(),
      (done) => input.current?.measureInWindow((_x, y, _w, h) => done(y, h)),
      `${row.setId}:${cell.field}`,
    );
  }, [fields, nav?.page, nav?.order, editable, testID, row.setId, cell.field]);
  /** The greyed suggestion, when it is a number the box can take as its own (not "max"). */
  const suggestion = draft === '' && !row.done && NUMERIC.test(cell.placeholder) ? cell.placeholder : null;
  const label = `${who}${SPOKEN[cell.field]}${cell.field === 'reps' ? '' : ` in ${cell.unit}`}`;
  const shown = draft || (row.done || readOnly ? '' : cell.placeholder) || '–';
  // Units inside the box at normal text sizes (approved SS boards), under it once they no longer fit.
  const inside = unitMode === 'auto' && fontScale <= UNIT_INSIDE_MAX_SCALE && boxWidth >= insideWidth(fit.value.length > shown.length ? fit.value : shown, fit.unit);
  const below = unitMode === 'auto' && !inside;
  const boxStyle = [
    styles.input,
    { borderRadius: radius.input, paddingHorizontal: space[1] },
    row.done && styles.inputDone,
    readOnly && styles.inputReadOnly,
    focused && styles.inputFocused,
    invalid !== null && styles.inputInvalid,
  ];
  const field = (
    <TextInput
      ref={input}
      testID={testID}
      value={draft}
      editable={editable}
      accessibilityState={{ disabled: disabled || readOnly }}
      keyboardType={KEYBOARD[cell.field]}
      returnKeyType="done"
      selectTextOnFocus
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      accessibilityLabel={label}
      accessibilityHint={invalid ?? (readOnly ? READ_ONLY_HINT : (WORD_HINTS[cell.placeholder.replace(/kg|lb/, 'unit')] ?? undefined))}
      placeholder={row.done || readOnly ? '' : cell.placeholder || '–'}
      placeholderTextColor={faded ? palette.borderStrong : palette.inkMuted}
      onFocus={() => {
        setFocused(true);
        atFocus.current = cell.value;
        fields?.focused(testID);
        // Tapped or reached with ‹ ›: the suggestion becomes the box's number, selected once it is in, so typing
        // replaces it. Only on focus (a press that turns into a swipe changes nothing); leaving without typing keeps
        // it unsaved (onBlur puts the stored value back).
        if (suggestion !== null) {
          setDraft(suggestion);
          requestAnimationFrame(() => input.current?.setSelection(0, suggestion.length));
        }
      }}
      onBlur={() => {
        setFocused(false);
        fields?.blurred(testID);
        // An unreadable draft ("1:7", "190" as m:ss) goes back to the value it had at focus.
        if (invalid !== null) {
          restoreFocusValue();
          setDraft(atFocus.current);
        } else {
          setDraft(cell.value);
        }
        setInvalid(null);
      }}
      onChangeText={(t) => {
        setDraft(t);
        const read = readTyped(cell.field, t, units, row.done);
        if (read.kind === 'invalid') {
          // accessibilityLiveRegion below is Android only: on iOS, VoiceOver is told the reason here, once.
          const say = invalidAnnouncement(invalid, read.message);
          if (say) AccessibilityInfo.announceForAccessibility(say);
          setInvalid(read.message);
          // While it can't be read, the set keeps its value from focus (an earlier keystroke may have saved part).
          restoreFocusValue();
          return;
        }
        setInvalid(null);
        onType(read.patch);
      }}
      style={[text('sectionHeading'), inside ? styles.inputInside : boxStyle]}
    />
  );
  return (
    <View style={[styles.cell, { gap: space[1] / 2 }]} onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}>
      {inside ? (
        // The whole box takes the tap (the unit beside the number too); VoiceOver reads the number box itself.
        <Pressable accessible={false} disabled={!editable} onPress={() => input.current?.focus()} style={[boxStyle, styles.boxRow]}>
          <View style={{ width: numberWidth(shown) }}>{field}</View>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            numberOfLines={1}
            importantForAccessibility="no"
            accessibilityElementsHidden
            style={[text('caption'), styles.unitInside]}
          >
            {cell.unit}
          </Text>
        </Pressable>
      ) : (
        field
      )}
      {invalid !== null ? (
        <Text testID={`invalid-${testID}`} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.invalidText]}>
          {invalid}
        </Text>
      ) : below ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.centre, row.done && styles.ink]}>
          {cell.unit}
        </Text>
      ) : null}
    </View>
  );
}

/** A superset row's gaps: a little tighter, so "10 reps each" fits inside its box on a phone. */
const ROW_GAP_TIGHT = 6;

/** Above this text size the unit goes under the box. */
const UNIT_INSIDE_MAX_SCALE = 1.15;

/** Roughly how wide the number is at 18 pt bold (its box sizes to it, so number and unit sit centred together). */
function numberWidth(value: string): number {
  return Math.max(2, value.length) * 11 + 4;
}

/** Roughly how wide "55 lb each" needs its box: the number, the unit at 12 pt, the gap and a little slack. */
function insideWidth(value: string, unit: string): number {
  return numberWidth(value) + unit.length * 6.2 + 8;
}

type RowProps = {
  row: RowModel;
  /** "<page>-<exercise>": test ids are `<what>-<idKey>-<setIndex>`. */
  idKey: string;
  /** Superset rows have no column headings, so each box says its unit (inside it, or under it at large text). */
  unitBelow: boolean;
  /** A superset row: "B1" (or the ↓ Drop chip) in place of the set number, drops not indented. */
  rowLabel?: string;
  /** A round still to come: fainter suggestions. */
  faded?: boolean;
  /** The row's own ··· (superset rows): the set menu. */
  showMore?: boolean;
  /** "A2 Curl, ": the exercise, for screen readers, on a superset where rows of several exercises sit together. */
  exerciseLabel: string | null;
  units: Units;
  disabled?: boolean;
  /** The coach logs this workout: the row shows the coach's numbers and can't be changed. */
  readOnly?: boolean;
  /** The set the coach ticked last (read only): outlined so the client sees where the coach is. */
  recent?: boolean;
  /** The Last time column (straight and pick-one pages). */
  showLast?: boolean;
  /** Its page and place on the page (for ‹ › on the keyboard bar). */
  page?: number;
  order?: number;
  handlers: TableHandlers;
};

/**
 * One set: tag, number boxes, ✓. Long-press the row (its tag or the space around the boxes) for "Delete set". There
 * is no swipe on a row: a sideways swipe always changes the page.
 */
function SetRowLineView({
  row,
  idKey,
  unitBelow,
  exerciseLabel,
  units,
  disabled = false,
  readOnly = false,
  recent = false,
  showLast = false,
  rowLabel,
  faded = false,
  showMore = false,
  page,
  order = 0,
  handlers,
}: RowProps) {
  const { logText: text, space, radius } = useTheme();
  // On a superset row a warm-up keeps its W and a drop its ↓ Drop; any other set shows the exercise's label (B1).
  const tagged = rowLabel !== undefined ? row.tagKind === 'warmup' || row.tagKind === 'drop' : row.tagKind !== 'normal';
  const tagText = rowLabel !== undefined && !tagged ? rowLabel : row.tag;
  const id = `${idKey}-${row.setIndex}`;
  const deletable = !disabled && !readOnly && row.deletable;
  const hasMenu = !disabled && !readOnly && (row.deletable || row.canDrop);
  const longest = (xs: string[]) => xs.reduce((a, b) => (b.length > a.length ? b : a), '');
  const fit = { value: longest(row.cells.map((c) => c.value || c.placeholder)), unit: longest(row.cells.map((c) => c.unit)) };
  const locked = disabled || readOnly;
  const setWords = row.name.charAt(0).toLowerCase() + row.name.slice(1);
  const who = `${exerciseLabel ? `${exerciseLabel}, ` : ''}${row.name}, `;
  const onAction = (e: AccessibilityActionEvent) => {
    if (deletable && e.nativeEvent.actionName === 'delete') handlers.onDelete(row);
  };
  return (
    // Not one element for VoiceOver (accessible false): the boxes and ✓ stay separate.
    <Pressable accessible={false} onLongPress={hasMenu ? () => handlers.onRowMenu(row) : undefined}>
      <View
        testID={`set-${id}`}
        accessibilityActions={deletable ? DELETE_ACTIONS : undefined}
        onAccessibilityAction={onAction}
        style={[
          styles.row,
          { gap: rowLabel !== undefined ? ROW_GAP_TIGHT : space[2], paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.input },
          row.indented && rowLabel === undefined && { marginLeft: space[4] },
          row.done && styles.rowDone,
          (recent || (row.current && !readOnly)) && styles.rowRecent,
        ]}
      >
        <Pressable
          testID={`tag-${id}`}
          disabled={!tagged && !hasMenu}
          onPress={tagged ? () => handlers.onTag(row) : undefined}
          onLongPress={hasMenu ? () => handlers.onRowMenu(row) : undefined}
          accessibilityActions={deletable ? DELETE_ACTIONS : undefined}
          onAccessibilityAction={onAction}
          accessibilityRole={tagged ? 'button' : 'text'}
          accessibilityLabel={tagged ? `${row.name}. What does ${row.tag} mean?` : row.name}
          style={({ pressed }) => [
            styles.tag,
            rowLabel !== undefined && styles.tagLabel,
            tagged && [styles.tagChip, { borderRadius: radius.pill }],
            pressed && styles.pressed,
          ]}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[
              text(row.tagKind === 'drop' || rowLabel !== undefined ? 'caption' : 'sectionHeading'),
              styles.ink,
              styles.centre,
              rowLabel !== undefined && styles.labelText,
            ]}
          >
            {tagText}
          </Text>
        </Pressable>
        {showLast ? (
          <Text
            testID={`last-${id}`}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityLabel={row.last ? `Last time ${row.last}` : 'No last time'}
            style={[text('caption'), styles.lastCol]}
          >
            {row.last ?? '–'}
          </Text>
        ) : null}
        {row.cells.map((cell, ci) => (
          <Cell
            key={cell.field}
            cell={cell}
            row={row}
            who={who}
            units={units}
            testID={`actual-${cell.field}-${id}`}
            unitMode={unitBelow ? 'auto' : 'none'}
            faded={faded}
            fit={fit}
            disabled={disabled}
            readOnly={readOnly}
            nav={page === undefined ? null : { page, order: order * 10 + ci }}
            onType={(patch) => handlers.onType(row, patch)}
          />
        ))}
        <Pressable
          testID={`tick-${id}`}
          ph-label="log_set_done"
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
          {/* An open tick is a blank circle (approved LT boards). */}
          {row.done ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('sectionHeading'), styles.tickMarkDone]}>
              ✓
            </Text>
          ) : null}
        </Pressable>
        {showMore ? (
          hasMenu ? (
            <Pressable
              testID={`set-more-${id}`}
              onPress={() => handlers.onRowMenu(row)}
              accessibilityRole="button"
              accessibilityLabel={`More for ${exerciseLabel ? `${exerciseLabel}, ` : ''}${setWords}`}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('sectionHeading'), styles.ink]}>
                ···
              </Text>
            </Pressable>
          ) : (
            <View style={styles.moreSpace} />
          )
        ) : null}
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
    a.row.last === b.row.last &&
    a.row.current === b.row.current &&
    a.row.canDrop === b.row.canDrop &&
    a.rowLabel === b.rowLabel &&
    a.faded === b.faded &&
    a.showMore === b.showMore &&
    a.showLast === b.showLast &&
    a.page === b.page &&
    a.order === b.order &&
    sameCells(a.row.cells, b.row.cells),
);

/** Above this text size on a phone narrower than this, the Last time column goes (the number boxes need the room). */
const LAST_COLUMN_MAX_FONT_SCALE = 1.3;
const LAST_COLUMN_NARROW = 430;

function useShowLastColumn(): boolean {
  const { width, fontScale } = useWindowDimensions();
  return !(fontScale > LAST_COLUMN_MAX_FONT_SCALE && width < LAST_COLUMN_NARROW);
}

/** A straight exercise's sets: SET | LAST TIME | LB | REPS | ✓ (columns follow the tracking type), then + Add set. */
export function SetTable({
  rows,
  idKey,
  units,
  page,
  disabled,
  readOnly = false,
  recentSetId = null,
  handlers,
  onAddSet,
}: {
  rows: RowModel[];
  idKey: string;
  units: Units;
  /** The page it is on (for ‹ › on the keyboard bar). */
  page: number;
  disabled?: boolean;
  readOnly?: boolean;
  recentSetId?: string | null;
  handlers: TableHandlers;
  onAddSet: (() => void) | null;
}) {
  const { logText: text, space, radius } = useTheme();
  const headings = rows[0]?.cells.map((c) => c.heading) ?? [];
  // No LAST TIME column without a last time (approved LT1 board).
  const showLast = useShowLastColumn() && rows.some((r) => r.last !== null);
  return (
    <View style={[styles.table, { borderRadius: radius.card, padding: space[2], gap: space[1] }]}>
      <View style={[styles.row, { gap: space[2], paddingHorizontal: space[2] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.tag, styles.headingText]}>
          SET
        </Text>
        {showLast ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.lastCol, styles.headingText]}>
            LAST TIME
          </Text>
        ) : null}
        {headings.map((h) => (
          <Text key={h} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[text('caption'), styles.cell, styles.centre, styles.headingText]}>
            {h}
          </Text>
        ))}
        <View style={styles.tickSpace} />
      </View>
      {rows.map((row, i) => (
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
          showLast={showLast}
          page={page}
          order={i}
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
      ph-label="log_add_set"
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
  table: {},
  row: { flexDirection: 'row', alignItems: 'center' },
  // A ticked set: a light grey row with an ink ✓ (no lime: lime is for creating something new).
  rowDone: { backgroundColor: palette.surface },
  lastCol: { width: 80, color: palette.inkMuted },
  flex: { flex: 1 },
  onInk: { color: white },
  rowRecent: { borderWidth: borderWidth.card * 2, borderColor: palette.ink },
  tag: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  tagChip: { backgroundColor: palette.drop },
  headingText: { minHeight: 0, letterSpacing: 0.6 },
  cell: { flex: 1 },
  input: {
    minHeight: tapTarget.min,
    backgroundColor: palette.bg,
    borderWidth: borderWidth.secondaryButton,
    borderColor: palette.borderStrong,
    textAlign: 'center',
  },
  // A ticked set: borderless grey cells (approved LT boards), still editable.
  inputDone: { borderColor: 'transparent', backgroundColor: palette.border },
  inputFocused: { borderColor: palette.ink, borderWidth: 2.5 },
  // Read only: no box to type in, just the number on the row (dashed, so it doesn't look tappable).
  inputReadOnly: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: palette.inkMuted },
  inputInvalid: { borderColor: palette.magentaDeep },
  invalidText: { color: palette.magentaDeep, textAlign: 'center' },
  centre: { textAlign: 'center' },
  ink: { color: palette.ink },
  boxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  inputInside: { minHeight: tapTarget.min, textAlign: 'right', borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
  unitInside: { color: palette.ink, fontSize: 12 },
  tagLabel: { width: 50, minWidth: 0, alignItems: 'flex-start' },
  labelText: { fontFamily: fontFamilyFor('sans', 800), textAlign: 'left' },
  more: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  moreSpace: { width: tapTarget.min },
  tick: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
  },
  tickSpace: { width: tapTarget.min },
  tickOpen: { backgroundColor: palette.bg, borderColor: palette.borderStrong },
  tickDone: { backgroundColor: palette.ink, borderColor: palette.ink },
  tickReadOnly: { borderStyle: 'dashed', borderColor: palette.inkMuted },
  tickMarkDone: { color: white },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: 0.4 },
  addSet: { minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: KEYBOARD_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.borderStrong,
  },
  barArrow: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  barOff: { opacity: 0.3 },
  barDone: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.ink },
});
