import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import type { StepField } from '@caltracker/shared';
import type { StepperModel } from '@/lib/log-page-model';
import { typedToStored } from '@/lib/stepper-input';
import { palette, pressedOpacity, stepperButtonSize, stepperValue } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const KEYBOARD: Record<StepField, KeyboardTypeOptions> = {
  weight: 'decimal-pad',
  reps: 'number-pad',
  duration: 'numbers-and-punctuation',
  distance: 'decimal-pad',
};

/** Characters that fit the number box at full size. */
const ROOM_CHARS = 4;

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
}: {
  model: StepperModel;
  page: number;
  onStep: (direction: -1 | 1) => void;
  onType: (value: number | null) => void;
}) {
  const { text, space, radius } = useTheme();
  const [draft, setDraft] = useState(model.display);
  const [focused, setFocused] = useState(false);
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
      <View style={[styles.row, { gap: space[2] }]}>
        <StepButton testID={`${id}-minus-${page}`} mark="−" label={model.lessLabel} onPress={() => step(-1)} />
        <TextInput
          ref={input}
          testID={`${id}-value-${page}`}
          value={draft}
          keyboardType={KEYBOARD[model.field]}
          returnKeyType="done"
          selectTextOnFocus
          placeholder="–"
          placeholderTextColor={palette.inkMuted}
          accessibilityLabel={`${NAME[model.field]}${model.field === 'reps' ? '' : ` in ${model.unit}`}`}
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
            stepperValue,
            fitValue(draft),
            styles.value,
            { borderRadius: radius.input },
            focused && styles.valueFocused,
          ]}
        />
        <StepButton testID={`${id}-plus-${page}`} mark="+" label={model.moreLabel} onPress={() => step(1)} />
      </View>
      <Text style={[text('caption'), styles.unit]}>{model.unit}</Text>
    </View>
  );
}

/** TextInput has no auto-fit: a long number shrinks (down to half size) so it stays inside the box. */
function fitValue(draft: string): { fontSize: number; lineHeight: number } | undefined {
  if (draft.length <= ROOM_CHARS) return undefined;
  const scale = Math.max(0.5, ROOM_CHARS / draft.length);
  return { fontSize: Math.floor(stepperValue.fontSize * scale), lineHeight: stepperValue.lineHeight };
}

function StepButton({ testID, mark, label, onPress }: { testID: string; mark: string; label: string; onPress: () => void }) {
  const { text, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, { borderRadius: radius.button }, pressed && styles.pressed]}
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
