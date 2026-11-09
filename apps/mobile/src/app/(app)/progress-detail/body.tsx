import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import {
  OVERVIEW_PERIODS,
  OVERVIEW_PERIOD_LABELS,
  bodyOverview,
  displayValue,
  formatMetric,
  formatShortDate,
  localToday,
  parseWeightInput,
  smoothedTrend,
  toInputValue,
  weightTrendSummary,
  type IsoDate,
  type OverviewPeriod,
} from '@caltracker/shared';
import { LineChart } from '@/components/progress/line-chart';
import { InkCard, OfflineNote, Overline, SectionHeader, Segmented, StatBox } from '@/components/progress/parts';
import { WeightTrendChart } from '@/components/progress/weight-trend-chart';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { Screen } from '@/components/ui';
import { PRINTOUT_FAILED, PROGRESS_LOAD_FAILED, deleteMyWeight, printoutUrl, saveMyWeight } from '@/lib/body-api';
import { buildProgress, stepWeightDate, type HistoryItem } from '@/lib/progress';
import { useSession } from '@/lib/session';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useBody, usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const RANGE_LABELS: Record<OverviewPeriod, string> = { '4w': '1 mo', '3m': '3 mo', '1y': '1 yr', all: 'All' };

/**
 * Body: log a weight, the latest weight, body fat and muscle with their change over the chosen range, the smoothed
 * weight trend over the single weigh-ins, the coach's last scan, the other measures' charts, and the history (the
 * client's own entries can be changed or deleted; printouts open from here).
 */
export default function BodyScreen() {
  const { text, space, radius } = useTheme();
  const { workspace } = useSession();
  const units = useUnits();
  const coach = useCoachProfile();
  const coachName = coach?.name.split(' ')[0] ?? null;
  const pull = usePullRefresh();
  const [savedKey, setSavedKey] = useState(0);
  const body = useBody(pull.refreshKey + savedKey);
  const data = body.data;
  const [range, setRange] = useState<OverviewPeriod>('3m');
  const today = localToday();
  const [formOpen, setFormOpen] = useState(false);
  const [weight, setWeight] = useState('');
  const [entryDate, setEntryDate] = useState<IsoDate>(() => localToday());
  const [editing, setEditing] = useState<HistoryItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const reload = () => setSavedKey((k) => k + 1);

  const model = useMemo(() => (data && units ? buildProgress(data, range, units, today, range) : null), [data, units, range, today]);

  const trend = useMemo(() => {
    if (!data || !units) return null;
    const weightPts = bodyOverview(data.scans, range, today).find((m) => m.key === 'weight_kg')?.points ?? [];
    if (weightPts.length === 0) return null;
    const smooth = smoothedTrend(weightPts);
    const shown = (p: { date: IsoDate; value: number }) => ({ date: p.date, value: displayValue('weight_kg', p.value, units) });
    const values = weightPts.map((p) => p.value);
    return {
      raw: weightPts.map(shown),
      trend: smooth.map(shown),
      summary: weightTrendSummary(smooth, weightPts.length, units, OVERVIEW_PERIOD_LABELS[range]),
      first: formatShortDate(weightPts[0].date, today),
      last: formatShortDate(weightPts.at(-1)!.date, today),
      low: formatMetric('weight_kg', Math.min(...values), units),
      high: formatMetric('weight_kg', Math.max(...values), units),
    };
  }, [data, units, range, today]);

  const lastScan = model?.history.find((h) => !h.mine) ?? null;
  const others = model?.charts.filter((c) => c.key !== 'weight_kg') ?? [];
  const tiles = (['weight_kg', 'body_fat_pct', 'smm_kg'] as const).map((key) => ({ key, l: model?.latest.find((x) => x.key === key) ?? null }));
  const tileName = { weight_kg: 'Weight', body_fat_pct: 'Body fat', smm_kg: 'Muscle' } as const;

  function openForm() {
    setFormOpen(true);
    setEditing(null);
    setWeight('');
    setEntryDate(localToday());
    setFormError(null);
  }

  function startEdit(item: HistoryItem) {
    if (!units || item.weightKg === null) return;
    setFormOpen(true);
    setEditing(item);
    setEntryDate(item.measuredOn);
    setWeight(String(toInputValue('weight_kg', item.weightKg, units)));
    setFormError(null);
  }

  function closeForm() {
    setFormOpen(false);
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
      await saveMyWeight({ workspaceId: workspace.workspaceId, measuredOn: entryDate, weightKg: parsed.kg, id: editing?.id });
      closeForm();
      reload();
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
              if (editing?.id === item.id) closeForm();
              reload();
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

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader
          title="Body"
          right={
            <Pressable
              testID="log-weight-open"
              accessibilityRole="button"
              accessibilityLabel="Log weight"
              onPress={openForm}
              style={({ pressed }) => [styles.logButton, { borderRadius: radius.input + 2, paddingHorizontal: space[3.5] }, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={text('sectionHeading')}>Log weight</Text>
            </Pressable>
          }
        />
        {body.status === 'offline' && data ? <OfflineNote show /> : null}
        {body.status === 'offline' && !data ? (
          <View style={{ gap: space[2] }}>
            <ErrorText>{PROGRESS_LOAD_FAILED}</ErrorText>
            <Button variant="secondary" title="Try again" onPress={pull.onRefresh} busy={pull.refreshing} />
          </View>
        ) : null}
        {!data && body.status === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}

        {formOpen ? (
          <InkCard style={{ gap: space[3] }} testID="weight-form">
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
              autoFocus={!editing}
            />
            <View style={[styles.row, { gap: space[2] }]}>
              <StepButton testID="date-prev" glyph="‹" label="Previous day" onPress={() => setEntryDate((d) => stepWeightDate(d, -1, localToday()))} />
              <Text
                testID="date-label"
                style={[text('sectionHeading'), styles.dateText]}
                accessibilityLabel={`Date ${formatShortDate(entryDate, today)}${entryDate === today ? ', today' : ''}`}
              >
                {entryDate === today ? `Today, ${formatShortDate(entryDate, today)}` : formatShortDate(entryDate, today)}
              </Text>
              <StepButton testID="date-next" glyph="›" label="Next day" disabled={entryDate >= today} onPress={() => setEntryDate((d) => stepWeightDate(d, 1, localToday()))} />
            </View>
            {formError ? <ErrorText testID="weight-error">{formError}</ErrorText> : null}
            <Button testID="weight-save" title={editing ? 'Save change' : 'Save weight'} onPress={() => void save()} busy={saving} disabled={units === null} />
            <TextButton testID="weight-cancel" title="Cancel" onPress={closeForm} />
          </InkCard>
        ) : null}

        {model ? (
          <>
            <View style={[styles.row, { gap: space[2] }]}>
              {tiles.map(({ key, l }, i) => (
                <StatBox
                  key={key}
                  testID={`latest-${key}`}
                  tone={i === 0 ? 'ink' : 'surface'}
                  label={tileName[key]}
                  value={l ? l.value : '–'}
                  sub={l ? (l.delta ?? l.date) : 'none yet'}
                />
              ))}
            </View>

            <InkCard>
              <Overline>{`Weight trend · ${OVERVIEW_PERIOD_LABELS[range].replace(/^Last /, '')}`}</Overline>
              {trend ? (
                <>
                  <WeightTrendChart
                    testID="chart-weight_kg"
                    raw={trend.raw}
                    trend={trend.trend}
                    summary={trend.summary}
                    firstLabel={trend.first}
                    lastLabel={trend.last}
                    lowLabel={trend.low}
                    highLabel={trend.high}
                  />
                  <Text style={text('caption')}>The line is your trend; dots are single weigh-ins.</Text>
                </>
              ) : (
                <Text style={text('body')} testID="body-empty">
                  {data && data.scans.length === 0
                    ? 'No weigh-ins yet. Log your weight, and your coach’s InBody scans will show here too.'
                    : 'No weigh-ins in this range. Try a longer one.'}
                </Text>
              )}
              <Segmented
                label="Time range"
                testIDPrefix="range"
                options={OVERVIEW_PERIODS.map((p) => ({ key: p, label: RANGE_LABELS[p] }))}
                value={range}
                onChange={setRange}
              />
            </InkCard>

            {lastScan ? (
              <View style={[styles.lineBox, { borderRadius: radius.button, padding: space[3], gap: space[2.5] }]} testID="last-scan">
                <View style={styles.grow}>
                  <Text style={text('sectionHeading')}>{`Last scan by ${coachName ?? 'your coach'}`}</Text>
                  <Text style={text('caption')}>{`${lastScan.date} · InBody`}</Text>
                </View>
                {lastScan.hasPrintout ? (
                  <ActionButton title="View printout" label={`View printout from ${lastScan.date}`} onPress={() => void openPrintout(lastScan)} boxed />
                ) : null}
              </View>
            ) : null}

            {others.map((c) => (
              <InkCard key={c.key}>
                <Text style={text('sectionHeading')} accessibilityRole="header">
                  {c.title}
                </Text>
                <LineChart chart={c} />
              </InkCard>
            ))}

            {model.history.length > 0 ? (
              <View style={{ gap: space[1] }}>
                <Text style={text('sectionHeading')} accessibilityRole="header">
                  History
                </Text>
                {model.history.map((h) => (
                  <View key={h.id} testID={`entry-${h.id}`} style={[styles.entry, { paddingVertical: space[2], gap: space[1] }]}>
                    <View style={[styles.row, { gap: space[2.5] }]}>
                      <Text style={[text('caption'), styles.when]}>{h.date}</Text>
                      <Text style={[text('sectionHeading'), styles.grow]}>{h.values.join(' · ')}</Text>
                      <Text style={text('caption')}>{h.mine ? 'Logged by you' : `From ${coachName ?? 'your coach'}`}</Text>
                    </View>
                    {h.hasPrintout || h.mine ? (
                      <View style={[styles.actions, { gap: space[3] }]}>
                        {h.hasPrintout ? <ActionButton title="View printout" label={`View printout from ${h.date}`} onPress={() => void openPrintout(h)} /> : null}
                        {h.mine ? (
                          <>
                            <ActionButton testID={`edit-${h.id}`} title="Edit" label={`Edit entry from ${h.date}`} onPress={() => startEdit(h)} />
                            <ActionButton testID={`delete-${h.id}`} title="Delete" label={`Delete entry from ${h.date}`} onPress={() => confirmDelete(h)} />
                          </>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Screen>
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
      style={({ pressed }) => [styles.step, disabled && styles.disabled, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={text('screenTitle')}>{glyph}</Text>
    </Pressable>
  );
}

/** Underlined text action (or a small outlined button) with a 44 pt target. */
function ActionButton({ title, label, onPress, testID, boxed = false }: { title: string; label: string; onPress: () => void; testID?: string; boxed?: boolean }) {
  const { text, radius, space } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, boxed && [styles.boxed, { borderRadius: radius.input, paddingHorizontal: space[3] }], pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[text(boxed ? 'sectionHeading' : 'body'), !boxed && styles.underline]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  logButton: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.lime, borderWidth: borderWidth.card, borderColor: palette.ink },
  dateText: { flex: 1, textAlign: 'center' },
  step: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  lineBox: { flexDirection: 'row', alignItems: 'center', borderWidth: borderWidth.card, borderColor: palette.border },
  entry: { borderBottomWidth: borderWidth.secondaryButton, borderBottomColor: palette.border },
  when: { width: 60 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 70 },
  action: { minHeight: tapTarget.min, minWidth: tapTarget.min, justifyContent: 'center' },
  boxed: { borderWidth: borderWidth.secondaryButton, borderColor: palette.ink },
  underline: { textDecorationLine: 'underline' },
});
