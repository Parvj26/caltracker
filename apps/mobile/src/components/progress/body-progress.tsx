import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { CHART_RANGES, CHART_RANGE_LABELS, formatShortDate, localToday, parseWeightInput, toInputValue, type ChartRange, type IsoDate } from '@caltracker/shared';
import { LineChart } from '@/components/progress/line-chart';
import { Button, Card, ErrorText, TextButton, TextField } from '@/components/ui';
import {
  PRINTOUT_FAILED,
  deleteMyWeight,
  fetchMyProgress,
  printoutUrl,
  readCachedProgress,
  saveMyWeight,
  PROGRESS_LOAD_FAILED,
} from '@/lib/body-api';
import { buildProgress, stepWeightDate, type HistoryItem, type ProgressRows } from '@/lib/progress';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * The client's body progress, shown on the Progress tab below Strength: the goal their coach set, their latest
 * weight, body fat and muscle, a chart per measure with two or more values, their own weight log, and the history.
 * `refreshKey` changes when the screen is pulled to refresh.
 */
export function BodyProgress({ refreshKey }: { refreshKey: number }) {
  const { text, space, radius } = useTheme();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const units = useUnits();
  const [data, setData] = useState<ProgressRows | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<ChartRange>('1y');
  const [today, setToday] = useState<IsoDate>(() => localToday());
  const [weight, setWeight] = useState('');
  const [entryDate, setEntryDate] = useState<IsoDate>(() => localToday());
  const [editing, setEditing] = useState<HistoryItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setToday(localToday()); // The day may have changed since the screen opened.
    try {
      const rows = await fetchMyProgress();
      if (ticket !== latest.current) return;
      setData(rows);
      setOffline(false);
      setError(null);
    } catch {
      if (ticket !== latest.current) return;
      // No signal: show what this phone saved last time, and say so.
      const cached = userId ? await readCachedProgress(userId) : null;
      if (ticket !== latest.current) return;
      if (cached) {
        setData(cached);
        setOffline(true);
        setError(null);
      } else {
        setError(PROGRESS_LOAD_FAILED);
      }
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // A pull to refresh on the screen reloads this section too (the first render is covered by the focus effect).
  useEffect(() => {
    if (refreshKey > 0) void load();
  }, [refreshKey, load]);

  const model = useMemo(() => (data && units ? buildProgress(data, range, units, today) : null), [data, units, range, today]);

  function startEdit(item: HistoryItem) {
    if (!units || item.weightKg === null) return;
    setEditing(item);
    setEntryDate(item.measuredOn);
    setWeight(String(toInputValue('weight_kg', item.weightKg, units)));
    setFormError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setWeight('');
    setEntryDate(localToday());
    setFormError(null);
  }

  async function save() {
    if (savingRef.current || !units || !workspace) return;
    const parsed = parseWeightInput(weight, units);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await saveMyWeight({
        workspaceId: workspace.workspaceId,
        measuredOn: entryDate,
        weightKg: parsed.kg,
        id: editing?.id,
      });
      setWeight('');
      setEditing(null);
      setEntryDate(localToday());
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save your weight.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function confirmDelete(item: HistoryItem) {
    Alert.alert(`Delete the entry from ${item.date}?`, 'This removes it from your chart.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete entry',
        style: 'destructive',
        onPress: () => {
          void deleteMyWeight(item.id)
            .then(() => {
              if (editing?.id === item.id) cancelEdit();
              return load();
            })
            .catch((e: unknown) => Alert.alert(e instanceof Error ? e.message : 'Could not delete that entry.'));
        },
      },
    ]);
  }

  async function openPrintout(item: HistoryItem) {
    try {
      if (!item.attachmentPath) return;
      await Linking.openURL(await printoutUrl(item.attachmentPath));
    } catch {
      Alert.alert(PRINTOUT_FAILED);
    }
  }

  const loading = !model && !error;

  return (
    <>
      {model?.goal ? (
        <Card>
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Your goal
          </Text>
          <Text style={text('body')} testID="goal-text">
            {model.goal.text}
          </Text>
          {model.goal.countdown ? (
            <Text style={text('caption')} testID="goal-countdown">
              {`${model.goal.countdown} · ${model.goal.date}`}
            </Text>
          ) : null}
          <Text style={text('caption')}>Set by your coach</Text>
        </Card>
      ) : null}

      <Text style={text('sectionHeading')} accessibilityRole="header">
        Body
      </Text>

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => void refresh()} busy={refreshing} />
        </Card>
      ) : null}
      {loading ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {offline ? <Text style={text('caption')}>No connection. This is your progress as last saved on this phone.</Text> : null}

      {model && model.latest.length > 0 ? (
        <Card>
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Latest
          </Text>
          {model.latest.map((l) => (
            <View
              key={l.key}
              testID={`latest-${l.key}`}
              accessible
              accessibilityLabel={`${l.label}, ${l.value} on ${l.date}.${l.change ? ` ${l.change}.` : ''}`}
              style={[styles.latest, { gap: space[1] }]}
            >
              <Text style={text('caption')}>{l.label}</Text>
              <Text style={text('bigNumber')}>{l.value}</Text>
              <Text style={text('caption')}>{l.change ? `${l.date} · ${l.change}` : l.date}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          {editing ? `Change your weight from ${editing.date}` : 'Log your weight'}
        </Text>
        <TextField
          testID="weight-input"
          label={units ? `Weight (${units})` : 'Weight'}
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          editable={units !== null}
        />
        <View style={[styles.stepper, { gap: space[2] }]}>
          <StepButton testID="date-prev" glyph="‹" label="Previous day" onPress={() => setEntryDate((d) => stepWeightDate(d, -1, localToday()))} />
          <Text testID="date-label" style={[text('sectionHeading'), styles.dateText]} accessibilityLabel={`Date ${formatShortDate(entryDate, today)}${entryDate === today ? ', today' : ''}`}>
            {entryDate === today ? `Today, ${formatShortDate(entryDate, today)}` : formatShortDate(entryDate, today)}
          </Text>
          <StepButton testID="date-next" glyph="›" label="Next day" disabled={entryDate >= today} onPress={() => setEntryDate((d) => stepWeightDate(d, 1, localToday()))} />
        </View>
        {formError ? <ErrorText testID="weight-error">{formError}</ErrorText> : null}
        <Button testID="weight-save" title={editing ? 'Save change' : 'Save weight'} onPress={() => void save()} busy={saving} disabled={units === null} />
        {editing ? <TextButton testID="weight-cancel" title="Cancel" onPress={cancelEdit} /> : null}
      </Card>

      {model ? (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel="Chart range" style={[styles.ranges, { gap: space[2] }]}>
            {CHART_RANGES.map((r) => (
              <Pressable
                key={r}
                testID={`range-${r}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: range === r }}
                onPress={() => setRange(r)}
                style={({ pressed }) => [
                  styles.range,
                  { borderRadius: radius.pill, paddingHorizontal: space[4] },
                  range === r && styles.rangeOn,
                  pressed && { opacity: pressedOpacity },
                ]}
              >
                <Text style={[text('sectionHeading'), range === r && styles.rangeOnText]}>{CHART_RANGE_LABELS[r]}</Text>
              </Pressable>
            ))}
          </View>

          {data && data.scans.length === 0 ? (
            <Text style={text('body')} testID="body-empty">
              No scans yet. Log your weight above, and your coach’s InBody scans will show here too.
            </Text>
          ) : model.charts.length === 0 && model.hiddenByRange === 0 ? (
            <Text style={text('body')} testID="progress-more">
              Add another entry to see a trend.
            </Text>
          ) : null}

          {model.charts.map((c) => (
            <Card key={c.key}>
              <Text style={text('sectionHeading')} accessibilityRole="header">
                {c.title}
              </Text>
              <LineChart chart={c} />
            </Card>
          ))}

          {model.hiddenByRange > 0 ? (
            <View style={{ gap: space[1] }}>
              <Text style={text('body')} testID="progress-hidden">
                {model.charts.length === 0
                  ? 'Not enough entries in this range for a chart.'
                  : `${model.hiddenByRange} more ${model.hiddenByRange === 1 ? 'measure has' : 'measures have'} older entries outside this range.`}
              </Text>
              <TextButton testID="show-all" title="Show all" onPress={() => setRange('all')} />
            </View>
          ) : null}

          {model.history.length > 0 ? (
            <Card>
              <Text style={text('sectionHeading')} accessibilityRole="header">
                History
              </Text>
              {model.history.map((h) => (
                <View key={h.id} testID={`entry-${h.id}`} style={[styles.entry, { gap: space[1] }]}>
                  <Text style={text('sectionHeading')}>{h.date}</Text>
                  <Text style={text('body')}>{h.values.join(' · ')}</Text>
                  <Text style={text('caption')}>{h.mine ? 'Logged by you' : 'From your coach'}</Text>
                  <View style={[styles.actions, { gap: space[3] }]}>
                    {h.hasPrintout ? (
                      <ActionButton title="View printout" label={`View printout from ${h.date}`} onPress={() => void openPrintout(h)} />
                    ) : null}
                    {h.mine ? (
                      <>
                        <ActionButton testID={`edit-${h.id}`} title="Edit" label={`Edit entry from ${h.date}`} onPress={() => startEdit(h)} />
                        <ActionButton testID={`delete-${h.id}`} title="Delete" label={`Delete entry from ${h.date}`} onPress={() => confirmDelete(h)} />
                      </>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function StepButton({ glyph, label, onPress, testID, disabled = false }: { glyph: string; label: string; onPress: () => void; testID: string; disabled?: boolean }) {
  const { text } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.step, disabled && { opacity: 0.4 }, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={text('screenTitle')}>{glyph}</Text>
    </Pressable>
  );
}

/** Underlined text action with a 44 pt target. */
function ActionButton({ title, label, onPress, testID }: { title: string; label: string; onPress: () => void; testID?: string }) {
  const { text } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[text('body'), styles.underline]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center' },
  dateText: { flex: 1, textAlign: 'center' },
  step: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  ranges: { flexDirection: 'row', flexWrap: 'wrap' },
  range: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.surface },
  rangeOn: { backgroundColor: palette.ink },
  rangeOnText: { color: palette.bg },
  entry: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12 },
  latest: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { minHeight: tapTarget.min, minWidth: tapTarget.min, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
});
