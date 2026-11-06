import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import type { StepField } from '@caltracker/shared';
import type { StepperModel } from '@/lib/log-page-model';
import { fitStepperFont } from '@/lib/stepper-fit';
import { typedToStored } from '@/lib/stepper-input';
import {
  palette,
  pressedOpacity,
  stepperButtonSize,
  stepperButtonSizeCompact,
  stepperCompactBelow,
  stepperValue,
  stepperValueCompact,
} from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const KEYBOARD: Record<StepField, KeyboardTypeOptions> = {
  weight: 'decimal-pad',
  reps: 'number-pad',
  duration: 'numbers-and-punctuation',
  distance: 'decimal-pad',
};

const NAME: Record<StepField, string> = { weight: 'Weight', reps: 'Reps', duration: 'Time', distance: 'Distance' };

/**
 * "−  number  +" for one field. The number is a text box: it keeps what is being typed while focused and shows the
 * stored value again on blur. onType gets the value in stored units (kg, reps, seconds, metres) or null when cleared.
 */
export function Stepper({
  model,
  page,
  onStep,
  onType,
  setName,
}: {
  model: StepperModel;
  page: number;
  onStep: (direction: -1 | 1) => void;
  onType: (value: number | null) => void;
  /** "Set 2": put in the number box's spoken label. */
  setName?: string;
}) {
  const { text, space, radius } = useTheme();
  const [draft, setDraft] = useState(model.display);
  const [focused, setFocused] = useState(false);
  const [rowWidth, setRowWidth] = useState(0);
  const [boxWidth, setBoxWidth] = useState(0);
  const compact = rowWidth > 0 && rowWidth < stepperCompactBelow;
  const size = compact ? stepperButtonSizeCompact : stepperButtonSize;
  const base = compact ? stepperValueCompact : stepperValue;
  const fontSize = fitStepperFont(boxWidth, Math.max(draft.length, 1), base.fontSize);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (!focused) setDraft(model.display);
  }, [model.display, focused]);

  const step = (d: -1 | 1) => {
    // Let go of the keyboard first so the new number replaces the draft.
    input.current?.blur();
    onStep(d);
  };
  const id = `stepper-${model.field}`;

  return (
    <View style={[styles.wrap, { gap: space[1] }]}>
      <View style={[styles.row, { gap: compact ? space[1] : space[2] }]} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        <StepButton size={size} testID={`${id}-minus-${page}`} mark="−" label={model.lessLabel} onPress={() => step(-1)} />
        <TextInput
          ref={input}
          testID={`${id}-value-${page}`}
          value={draft}
          keyboardType={KEYBOARD[model.field]}
          returnKeyType="done"
          selectTextOnFocus
          placeholder="–"
          placeholderTextColor={palette.inkMuted}
          accessibilityLabel={`${setName ? `${setName} ` : ''}${NAME[model.field].toLowerCase()}${model.field === 'reps' ? '' : ` in ${model.unit}`}`}
          onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
          numberOfLines={1}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(model.display);
          }}
          onChangeText={(t) => {
            setDraft(t);
            const v = typedToStored(model.field, model.unit, t);
            if (v !== undefined) onType(v);
          }}
          style={[
            text('bigNumber'),
            base,
            { fontSize, minHeight: size },
            styles.value,
            { borderRadius: radius.input },
            focused && styles.valueFocused,
          ]}
        />
        <StepButton size={size} testID={`${id}-plus-${page}`} mark="+" label={model.moreLabel} onPress={() => step(1)} />
      </View>
      <Text style={[text('caption'), styles.unit]}>{model.unit}</Text>
    </View>
  );
}

function StepButton({ testID, mark, label, size, onPress }: { testID: string; mark: string; label: string; size: number; onPress: () => void }) {
  const { text, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, { width: size, height: size },  { borderRadius: radius.button }, pressed && styles.pressed]}
    >
      <Text style={[text('screenTitle'), styles.mark]}>{mark}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    width: stepperButtonSize,
    height: stepperButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
  mark: { color: palette.ink },
  pressed: { opacity: pressedOpacity },
  value: {
    flex: 1,
    minWidth: 0,
    minHeight: stepperButtonSize,
    textAlign: 'center',
    color: palette.ink,
    borderWidth: borderWidth.card,
    borderColor: palette.surface,
    backgroundColor: palette.surface,
  },
  valueFocused: { borderColor: palette.ink, backgroundColor: palette.bg },
  unit: { textAlign: 'center' },
});
