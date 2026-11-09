import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import {
  STRENGTH_RANGES,
  STRENGTH_RANGE_LABELS,
  localToday,
  mostTrained,
  pointsInRange,
  sessionRows,
  strengthHeadline,
  type StrengthRange,
} from '@caltracker/shared';
import { LineChart } from '@/components/charts/line-chart';
import { InkCard, OfflineNote, Overline, SectionHeader, Segmented } from '@/components/progress/parts';
import { StrengthPicker } from '@/components/progress/strength-picker';
import { Screen } from '@/components/ui';
import { readLastExercise, rememberLastExercise } from '@/lib/progress-hub-api';
import { prKeys } from '@/lib/progress-hub-logic';
import { useSession } from '@/lib/session';
import { chartModel } from '@/lib/strength-logic';
import { useHub, usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Strength: one exercise at a time (picked from a searchable list, or a chip for the three most trained in the last 3
 * months), its estimated max over 1 month, 3 months or all time, one plain sentence, and its recent sessions with PR
 * tags. The last exercise picked is remembered on the phone.
 */
export default function StrengthScreen() {
  const { text, space, radius } = useTheme();
  const params = useLocalSearchParams<{ exercise?: string }>();
  const userId = useSession().session?.user.id ?? null;
  const units = useUnits() ?? 'lb';
  const pull = usePullRefresh();
  const hub = useHub(pull.refreshKey);
  const [chosen, setChosen] = useState<string | null>(typeof params.exercise === 'string' ? params.exercise : null);
  const [range, setRange] = useState<StrengthRange>('3m');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const today = localToday();

  // The exercise from last time, unless a Personal best row opened this screen on one.
  useEffect(() => {
    if (!userId || params.exercise) return;
    let alive = true;
    void readLastExercise(userId).then((id) => {
      if (alive && id) setChosen((c) => c ?? id);
    });
    return () => {
      alive = false;
    };
  }, [userId, params.exercise]);

  const exercises = useMemo(() => hub.data?.exercises ?? [], [hub.data]);
  const chips = useMemo(() => mostTrained(exercises, today), [exercises, today]);
  const exercise = exercises.find((e) => e.exerciseId === chosen) ?? chips[0] ?? exercises[0] ?? null;

  const choose = (id: string) => {
    setChosen(id);
    setPicked(null);
    if (userId) rememberLastExercise(userId, id);
  };

  const view = useMemo(() => {
    if (!exercise || !hub.data) return null;
    const points = pointsInRange(exercise.points, range, today);
    return {
      headline: strengthHeadline(points, units, today),
      chart: chartModel({ ...exercise, points }, units),
      points,
      sessions: sessionRows(exercise.sessions.slice(0, 5), prKeys(hub.data), exercise.exerciseId, units, today),
    };
  }, [exercise, hub.data, range, units, today]);
  const readout = view && view.chart.points.length > 0 ? (view.chart.points[Math.min(picked ?? view.chart.points.length - 1, view.chart.points.length - 1)]?.label ?? '') : '';

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader title="Strength" />
        <OfflineNote show={hub.status === 'offline'} />

        {hub.data && !exercise ? (
          <Text style={text('body')} testID="progress-empty">
            Log a workout with weights and your lifts will be charted here.
          </Text>
        ) : null}

        {exercise && view ? (
          <>
            <Pressable
              testID="strength-picker"
              onPress={() => setPicking(true)}
              accessibilityRole="button"
              accessibilityLabel={`Exercise: ${exercise.name}. Change`}
              accessibilityHint="Opens the list of your exercises"
              style={({ pressed }) => [styles.pickerButton, { borderRadius: radius.button, paddingHorizontal: space[4], gap: space[2.5] }, pressed && { opacity: pressedOpacity }]}
            >
              <View style={styles.grow}>
                <Text style={text('caption')}>Exercise</Text>
                <Text style={text('sectionHeading')}>{exercise.name}</Text>
              </View>
              <Text style={text('sectionHeading')}>Change ▾</Text>
            </Pressable>

            {chips.length > 1 ? (
              <View style={{ gap: space[2] }}>
                <Text style={text('caption')}>Your most trained</Text>
                <View style={[styles.chips, { gap: space[2] }]}>
                  {chips.map((c) => {
                    const on = c.exerciseId === exercise.exerciseId;
                    return (
                      <Pressable
                        key={c.exerciseId}
                        testID={`progress-exercise-${c.name}`}
                        onPress={() => choose(c.exerciseId)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={({ pressed }) => [styles.chip, { borderRadius: radius.pill, paddingHorizontal: space[3.5] }, on && styles.chipOn, pressed && { opacity: pressedOpacity }]}
                      >
                        <Text style={[text('sectionHeading'), on && styles.onInk]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <InkCard>
              <Overline>Estimated max</Overline>
              <Text style={text('bigNumber')} testID="strength-value">
                {view.headline.value ?? '–'}
                {view.headline.change ? <Text style={text('sectionHeading')}>{`  ${view.headline.change}`}</Text> : null}
              </Text>
              {view.chart.points.length > 0 ? (
                <LineChart
                  key={`${exercise.exerciseId}-${range}`}
                  testID="strength-chart"
                  points={view.chart.points}
                  title={view.chart.summary}
                  yLabel={view.chart.yLabel}
                  xLabel={view.chart.xLabel}
                  onPick={setPicked}
                />
              ) : null}
              {readout ? (
                <Text style={text('caption')} accessibilityLiveRegion="polite" testID="strength-readout">
                  {readout}
                </Text>
              ) : null}
              <Segmented
                label="Time range"
                testIDPrefix="strength-range"
                options={STRENGTH_RANGES.map((r) => ({ key: r, label: STRENGTH_RANGE_LABELS[r] }))}
                value={range}
                onChange={(r) => {
                  setRange(r);
                  setPicked(null);
                }}
              />
            </InkCard>
            <Text style={text('body')} testID="strength-summary">
              {view.headline.line}
            </Text>

            {view.sessions.length > 0 ? (
              <View style={{ gap: space[2] }}>
                <Text style={text('sectionHeading')} accessibilityRole="header">
                  {`Recent sessions (${units})`}
                </Text>
                {view.sessions.map((s) => (
                  <View
                    key={s.logId}
                    accessible
                    accessibilityLabel={s.label}
                    testID={`strength-session-${s.logId}`}
                    style={[styles.session, { borderRadius: radius.input + 2, paddingHorizontal: space[3.5], paddingVertical: space[2.5], gap: space[2.5] }]}
                  >
                    <Text style={[text('caption'), styles.when]}>{s.when}</Text>
                    <Text style={[text('sectionHeading'), styles.grow]}>{s.sets}</Text>
                    {s.pr ? <Text style={[text('caption'), styles.prTag, { borderRadius: radius.pill, paddingHorizontal: space[2] }]}>PR</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}

            <StrengthPicker
              visible={picking}
              exercises={exercises}
              selectedId={exercise.exerciseId}
              units={units}
              onClose={() => setPicking(false)}
              onPick={(id) => {
                choose(id);
                setPicking(false);
              }}
            />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pickerButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderWidth: borderWidth.card, borderColor: palette.ink, backgroundColor: palette.bg },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minHeight: tapTarget.min, justifyContent: 'center', borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, backgroundColor: palette.bg },
  chipOn: { backgroundColor: palette.ink },
  onInk: { color: white },
  session: { flexDirection: 'row', alignItems: 'center', borderWidth: borderWidth.card, borderColor: palette.border },
  when: { width: 64 },
  prTag: { color: palette.ink, backgroundColor: palette.tape, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, overflow: 'hidden', paddingVertical: 2 },
});
