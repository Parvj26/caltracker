import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { borderWidth, buttonMinHeight, tapTarget } from '@caltracker/design-tokens';
import {
  METRIC_CATALOGUE,
  METRIC_KEYS,
  formatShortDate,
  localToday,
  metricInputValue,
  metricUnit,
  parseMetricInput,
  type IsoDate,
  type MetricEntry,
  type MetricKey,
  type Units,
} from '@caltracker/shared';
import { Button, ErrorText, TextButton } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/icons';
import { deleteMyWeight, saveMyWeight } from '@/lib/body-api';
import type { ShownError } from '@/lib/error-shown';
import { deleteMyMetric, saveMyMetric } from '@/lib/metrics-api';
import { clientEditKind, lastValueLine } from '@/lib/metrics-view';
import { stepWeightDate } from '@/lib/progress';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * "Log a metric" (approved log sheet, client version without the InBody scan link): pick the metric, type the value
 * in the client's own unit, step the date (never past today), Save. Opened with an entry, it changes or deletes that
 * entry instead (the client's own only: new Metrics entries, or weigh-ins from before Metrics).
 */
export function LogMetricSheet({
  visible,
  workspaceId,
  units,
  entries,
  coachFirstName,
  initialKey,
  editing,
  onClose,
  onSaved,
}: {
  visible: boolean;
  workspaceId: string | null;
  units: Units | null;
  entries: readonly MetricEntry[];
  coachFirstName: string | null;
  initialKey: MetricKey;
  editing: MetricEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { text, space, radius, device } = useTheme();
  const today = localToday();
  const [key, setKey] = useState<MetricKey>(initialKey);
  const [value, setValue] = useState('');
  const [date, setDate] = useState<IsoDate>(today);
  const [error, setError] = useState<ShownError | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const keyboardPad = useKeyboardPad(visible);

  useEffect(() => {
    if (!visible) return;
    setKey(editing?.metricKey ?? initialKey);
    setValue(editing && units ? String(metricInputValue(editing.metricKey, editing.value, units)) : '');
    setDate(editing?.measuredOn ?? localToday());
    setError(null);
  }, [visible, editing, initialKey, units]);

  const def = METRIC_CATALOGUE[key];
  const unit = units ? metricUnit(key, units) : '';
  const last = units && !editing ? lastValueLine(entries, key, units, today, coachFirstName) : null;
  const kind = editing ? clientEditKind(editing) : null;
  const dateText = date === today ? `Today, ${formatShortDate(date, today)}` : formatShortDate(date, today);

  async function save() {
    if (savingRef.current || !units || !workspaceId) return;
    const parsed = parseMetricInput(key, value, units);
    if (!parsed.ok) {
      setError({ code: 'metric_invalid', text: parsed.error });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (editing && kind === 'weighin') {
        await saveMyWeight({ workspaceId, measuredOn: date, weightKg: parsed.value, id: editing.id });
      } else {
        await saveMyMetric({ workspaceId, metricKey: key, measuredOn: date, value: parsed.value, id: editing?.id });
      }
      onSaved();
      onClose();
    } catch {
      setError({ code: 'metric_save_failed', text: 'Could not save that. Check your connection and try again.' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!editing) return;
    const when = formatShortDate(editing.measuredOn, today);
    Alert.alert(`Delete the entry from ${when}?`, 'This removes it from your Metrics.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete entry',
        style: 'destructive',
        onPress: () => {
          const done = kind === 'weighin' ? deleteMyWeight(editing.id) : deleteMyMetric(editing.id);
          void done
            .then(() => {
              onSaved();
              onClose();
            })
            .catch((e: unknown) => Alert.alert(e instanceof Error ? e.message : 'Could not delete that entry.'));
        },
      },
    ]);
  }

  const title = editing ? `Change ${def.label.toLowerCase().replace('vo2', 'VO2')} from ${formatShortDate(editing.measuredOn, today)}` : 'Log a metric';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        {/* The pinned Save stays above the keyboard. */}
        <View style={[styles.column, styles.flex, { paddingBottom: keyboardPad }]}>
          <View style={[styles.row, { paddingHorizontal: space[4], paddingTop: space[3], gap: space[2] }]}>
            <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header" testID="metric-sheet-title">
              {title}
            </Text>
            <CloseButton onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4.5] }} keyboardShouldPersistTaps="handled">
            {!editing ? (
              <View style={{ gap: space[2.5] }} accessibilityRole="radiogroup" accessibilityLabel="What">
                <Text style={text('sectionHeading')}>What</Text>
                <View style={[styles.wrap, { gap: space[2] }]}>
                  {METRIC_KEYS.map((k) => {
                    const on = k === key;
                    return (
                      <Pressable
                        key={k}
                        testID={`metric-chip-${k}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        onPress={() => {
                          setKey(k);
                          setError(null);
                        }}
                        style={({ pressed }) => [
                          styles.chip,
                          { borderRadius: radius.pill, paddingHorizontal: space[4] },
                          on ? styles.chipOn : styles.chipOff,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[text('sectionHeading'), on && styles.onText]}>{METRIC_CATALOGUE[k].label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={{ gap: space[2] }}>
              <Text style={text('sectionHeading')}>{def.label}</Text>
              <View style={[styles.field, { borderRadius: radius.input, paddingHorizontal: space[3.5], minHeight: buttonMinHeight[device] }]}>
                <TextInput
                  testID="metric-input"
                  accessibilityLabel={`${def.label}${unit ? ` in ${unit}` : ''}`}
                  value={value}
                  onChangeText={setValue}
                  // No return key: on a number pad React Native would add a "Done" bar that covers the Save button.
                  keyboardType="decimal-pad"
                  editable={units !== null}
                  autoFocus={!editing}
                  placeholder="0"
                  placeholderTextColor={palette.inkMuted}
                  style={[text('bigNumber'), styles.input]}
                />
                <Text style={text('sectionHeading')}>{unit}</Text>
              </View>
              {/* Right under the value, so it shows above the keyboard. */}
              {error ? (
                <ErrorText testID="metric-error" code={error.code}>
                  {error.text}
                </ErrorText>
              ) : null}
            </View>

            <View style={{ gap: space[2] }}>
              <Text style={text('sectionHeading')}>Date</Text>
              <View style={[styles.row, styles.field, { borderRadius: radius.input, gap: space[1] }]}>
                <StepButton testID="metric-date-prev" direction="left" label="Previous day" onPress={() => setDate((d) => stepWeightDate(d, -1, localToday()))} />
                <Text testID="metric-date" style={[text('sectionHeading'), styles.dateText]} accessibilityLabel={`Date ${formatShortDate(date, today)}${date === today ? ', today' : ''}`}>
                  {dateText}
                </Text>
                <StepButton
                  testID="metric-date-next"
                  direction="right"
                  label="Next day"
                  disabled={date >= today}
                  onPress={() => setDate((d) => stepWeightDate(d, 1, localToday()))}
                />
              </View>
            </View>

            {last ? (
              <Text style={text('body')} testID="metric-last">
                {last}
              </Text>
            ) : null}
            {editing ? <TextButton testID="metric-delete" title="Delete this entry" onPress={confirmDelete} /> : null}
          </ScrollView>
          <View style={[styles.footer, { padding: space[4] }]}>
            <Button
              testID="metric-save"
              title={editing ? 'Save change' : `Save ${def.label.toLowerCase().replace('vo2', 'VO2')}`}
              onPress={() => void save()}
              busy={saving}
              disabled={units === null || workspaceId === null}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="metric-sheet-close"
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={onPress}
      style={({ pressed }) => [styles.close, pressed && styles.pressed]}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.4} strokeLinecap="round" accessibilityElementsHidden importantForAccessibility="no">
        <Path d="M6 6l12 12M18 6L6 18" />
      </Svg>
    </Pressable>
  );
}

function StepButton({ direction, label, onPress, testID, disabled = false }: { direction: 'left' | 'right'; label: string; onPress: () => void; testID: string; disabled?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.step, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <ChevronIcon direction={direction} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minHeight: tapTarget.min, justifyContent: 'center', borderWidth: borderWidth.secondaryButton },
  chipOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipOff: { backgroundColor: palette.surface, borderColor: 'transparent' },
  onText: { color: palette.bg },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: borderWidth.secondaryButton, borderColor: palette.borderStrong, backgroundColor: palette.surface },
  input: { flex: 1, minWidth: 0, paddingVertical: 8 },
  dateText: { flex: 1, textAlign: 'center' },
  step: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: pressedOpacity },
  close: { width: tapTarget.min, height: tapTarget.min, borderRadius: tapTarget.min / 2, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  footer: { borderTopWidth: 1, borderTopColor: palette.border },
});

/**
 * Room to keep the pinned footer above the keyboard. React Native's KeyboardAvoidingView (and measureInWindow) measure
 * inside the page sheet, which starts below the top of the screen, so they leave the footer under the keyboard. The
 * sheet reaches the bottom of the screen and the footer sits on the bottom safe area, so the keyboard covers its
 * height minus that inset.
 */
function useKeyboardPad(active: boolean): number {
  const { bottom } = useSafeAreaInsets();
  const [pad, setPad] = useState(0);
  useEffect(() => {
    if (!active) return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => setPad(Math.max(0, e.endCoordinates.height - bottom)));
    const hide = Keyboard.addListener('keyboardWillHide', () => setPad(0));
    return () => {
      show.remove();
      hide.remove();
      setPad(0);
    };
  }, [active, bottom]);
  return pad;
}
