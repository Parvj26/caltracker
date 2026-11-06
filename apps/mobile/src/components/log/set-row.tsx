import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import {
  TARGET_FIELDS,
  distanceUnitFor,
  formatClock,
  formatLogSetTarget,
  formatRest,
  fromMeters,
  kgToInput,
  toKg,
  toMeters,
  type ActualPatch,
  type LogSetDoc,
  type TrackingType,
  type Units,
} from '@caltracker/shared';
import { parseActualInput, type ActualField } from '@/lib/active-log-logic';
import { actualInputMinFontScale, actualInputRoomChars, actualInputWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { SwipeToDelete } from './swipe-to-delete';

const MAX_KG = 1000;
const MAX_M = 1_000_000;

type FieldSpec = {
  field: ActualField;
  unit: string;
  keyboard: KeyboardTypeOptions;
  /** The stored value as the box shows it. */
  show: (s: LogSetDoc) => string;
  /** A number typed in the box's unit to the stored patch, or null when it can't be stored. */
  patch: (v: number | null) => ActualPatch | null;
};

function fieldSpecs(trackingType: TrackingType, units: Units): FieldSpec[] {
  const dist = distanceUnitFor(units);
  const all: Record<ActualField, FieldSpec> = {
    weight: {
      field: 'weight',
      unit: units,
      keyboard: 'decimal-pad',
      show: (s) => (s.actualWeightKg === null ? '' : String(kgToInput(s.actualWeightKg, units))),
      patch: (v) => {
        if (v === null) return { actualWeightKg: null };
        const kg = toKg(v, units);
        return kg <= MAX_KG ? { actualWeightKg: kg } : null;
      },
    },
    reps: {
      field: 'reps',
      unit: 'reps',
      keyboard: 'number-pad',
      show: (s) => (s.actualReps === null ? '' : String(s.actualReps)),
      patch: (v) => ({ actualReps: v }),
    },
    duration: {
      field: 'duration',
      unit: 'm:ss',
      keyboard: 'numbers-and-punctuation',
      show: (s) => (s.actualDurationS === null ? '' : formatClock(s.actualDurationS)),
      patch: (v) => ({ actualDurationS: v }),
    },
    distance: {
      field: 'distance',
      unit: dist,
      keyboard: 'decimal-pad',
      show: (s) => (s.actualDistanceM === null ? '' : String(fromMeters(s.actualDistanceM, dist))),
      patch: (v) => {
        if (v === null) return { actualDistanceM: null };
        const m = toMeters(v, dist);
        return m <= MAX_M ? { actualDistanceM: m } : null;
      },
    },
  };
  // Weight first, then reps, as people say it ("135 × 8").
  const order: ActualField[] = ['weight', 'reps', 'duration', 'distance'];
  const keep = TARGET_FIELDS[trackingType] as readonly string[];
  return order.filter((f) => keep.includes(f)).map((f) => all[f]);
}

/** One actual box. Keeps what is being typed; saves every readable value; shows the stored value again on blur. */
function ActualInput({
  spec,
  set,
  testID,
  setName,
  onChange,
}: {
  spec: FieldSpec;
  set: LogSetDoc;
  testID: string;
  setName: string;
  onChange: (patch: ActualPatch) => void;
}) {
  const { text, space, radius } = useTheme();
  const stored = spec.show(set);
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(stored);
  }, [stored, focused]);

  return (
    <View style={[styles.inputWrap, { gap: space[1] }]}>
      <TextInput
        testID={testID}
        value={draft}
        keyboardType={spec.keyboard}
        returnKeyType="done"
        selectTextOnFocus
        accessibilityLabel={`${setName} ${spec.field === 'reps' ? 'reps' : spec.field}${spec.field === 'reps' ? '' : ` in ${spec.unit}`}`}
        placeholder="–"
        placeholderTextColor={palette.inkMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDraft(stored);
        }}
        onChangeText={(t) => {
          setDraft(t);
          const v = parseActualInput(t, spec.field);
          if (v === undefined) return;
          const patch = spec.patch(v);
          if (patch) onChange(patch);
        }}
        style={[
          text('sectionHeading'),
          styles.input,
          fitFont(text('sectionHeading').fontSize, draft),
          { borderRadius: radius.input, paddingHorizontal: space[2] },
          focused && styles.inputFocused,
        ]}
      />
      <Text style={[text('caption'), styles.centre]}>{spec.unit}</Text>
    </View>
  );
}

/** Text longer than the box has room for shrinks to fit (down to a floor) instead of clipping. TextInput has no auto-fit. */
function fitFont(fontSize: number | undefined, draft: string): { fontSize: number } | undefined {
  if (fontSize === undefined || draft.length <= actualInputRoomChars) return undefined;
  const scale = Math.max(actualInputMinFontScale, actualInputRoomChars / draft.length);
  return { fontSize: Math.floor(fontSize * scale) };
}

/**
 * A set while logging: its label (tap for the set menu), the coach's target, editable actuals in the client's
 * units, and a big ✓. Drop sets sit indented on the drop pastel.
 */
export function SetRow({
  set,
  label,
  trackingType,
  units,
  index,
  onTick,
  onChange,
  onMenu,
  onDelete,
}: {
  set: LogSetDoc;
  /** "W", "1", "2" or "↳". */
  label: string;
  trackingType: TrackingType;
  units: Units;
  /** "<exerciseIndex>-<setIndex>", for test ids. */
  index: string;
  onTick: () => void;
  onChange: (patch: ActualPatch) => void;
  onMenu: () => void;
  /** The swipe's Delete button: the same removal as "Remove set" in the menu. */
  onDelete: () => void;
}) {
  const { text, space, radius } = useTheme();
  const drop = set.setType === 'drop';
  const done = set.completedAt !== null;
  const setName = drop ? 'Drop set' : label === 'W' ? 'Warm-up' : `Set ${label}`;
  const rest = formatRest(set.target.restSeconds ?? 0);
  const target = formatLogSetTarget(set.target, trackingType, units);

  return (
    <SwipeToDelete testID={`set-delete-${index}`} label={`Delete ${setName.toLowerCase()}`} onDelete={onDelete}>
    <View
      testID={`set-${index}`}
      style={[
        styles.row,
        { gap: space[2.5], padding: space[2.5], borderRadius: radius.input },
        drop && [styles.dropRow, { marginLeft: space[6] }],
        done && styles.doneRow,
      ]}
    >
      <View>
        <Pressable
          testID={`set-menu-${index}`}
          onPress={onMenu}
          accessibilityRole="button"
          accessibilityLabel={`${setName} options`}
          style={({ pressed }) => [styles.label, { borderRadius: radius.input }, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>{label}</Text>
        </Pressable>
        {/* Under the number so the value boxes keep their width on a phone. */}
        <Pressable
          testID={`set-more-${index}`}
          onPress={onMenu}
          accessibilityRole="button"
          accessibilityLabel={`More for ${setName.toLowerCase()}`}
          style={({ pressed }) => [styles.label, { borderRadius: radius.input }, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>⋯</Text>
        </Pressable>
      </View>

      <View style={[styles.flex, { gap: space[2] }]}>
        {/* Text on the drop and lime pastels is always ink, never muted. */}
        <Text style={[text('caption'), (drop || done) && styles.ink]}>
          {rest ? `${target} · ${rest}` : target}
        </Text>
        <View style={[styles.inputs, { gap: space[2] }]}>
          {fieldSpecs(trackingType, units).map((spec) => (
            <ActualInput
              key={spec.field}
              spec={spec}
              set={set}
              setName={setName}
              testID={`actual-${spec.field}-${index}`}
              onChange={onChange}
            />
          ))}
        </View>
      </View>

      <Pressable
        testID={`tick-${index}`}
        onPress={onTick}
        hitSlop={4}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${setName} done`}
        style={({ pressed }) => [
          styles.tick,
          { borderRadius: radius.button },
          done ? styles.tickDone : styles.tickOpen,
          pressed && styles.tickPressed,
        ]}
      >
        <Text style={[text('screenTitle'), done ? styles.tickMarkDone : styles.tickMarkOpen]}>✓</Text>
      </Pressable>
    </View>
    </SwipeToDelete>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface },
  dropRow: { backgroundColor: palette.drop },
  doneRow: { backgroundColor: palette.lime },
  label: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: palette.bg },
  flex: { flex: 1 },
  ink: { color: palette.ink },
  inputs: { flexDirection: 'row' },
  inputWrap: { width: actualInputWidth },
  input: {
    minHeight: tapTarget.min,
    backgroundColor: palette.bg,
    borderWidth: borderWidth.card,
    borderColor: palette.border,
    textAlign: 'center',
  },
  inputFocused: { borderColor: palette.ink },
  centre: { textAlign: 'center' },
  tick: {
    width: tapTarget.logging,
    height: tapTarget.logging,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
  },
  tickOpen: { backgroundColor: palette.bg, borderColor: palette.ink },
  tickDone: { backgroundColor: palette.ink, borderColor: palette.ink },
  tickPressed: { opacity: pressedOpacity },
  tickMarkOpen: { color: palette.inkMuted },
  tickMarkDone: { color: palette.lime },
});
