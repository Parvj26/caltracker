import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import {
  STRENGTH_RANGES,
  STRENGTH_RANGE_LABELS,
  heaviestSentence,
  heaviestSessionRows,
  heaviestSessions,
  loadStyleOf,
  localToday,
  mostTrained,
  pointsInRange,
  strengthStats,
  type StrengthRange,
} from '@caltracker/shared';
import { LineChart } from '@/components/charts/line-chart';
import { InkCard, LoadState, SectionHeader, Segmented } from '@/components/progress/parts';
import { StrengthPicker } from '@/components/progress/strength-picker';
import { Screen } from '@/components/ui';
import { readLastExercise, rememberLastExercise } from '@/lib/progress-hub-api';
import { useSession } from '@/lib/session';
import { chartModel } from '@/lib/strength-logic';
import { useHub, usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useStacked } from '@/components/today/parts';

/**
 * Strength: one exercise at a time (picked from a searchable list, or a chip for the three most trained in the last 3
 * months). It headlines the heaviest weight lifted, with the estimated 1-rep max second (product owner, 2026-11-19,
 * the same numbers the coach sees), one plain sentence, the heaviest weight per session over 1 month, 3 months or all
 * time, and the recent sessions with "Heaviest yet" tags. The last exercise picked is remembered on the phone.
 */
export default function StrengthScreen() {
  const { text, space, radius } = useTheme();
  const stacked = useStacked();
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
    const style = loadStyleOf(exercise.name);
    // "Heaviest yet" looks at the whole history; the numbers, chart and sentence at the chosen range.
    const all = heaviestSessions(exercise.points, style);
    const inRange = pointsInRange(all, range, today);
    return {
      stats: strengthStats(inRange, units, style, today),
      line: heaviestSentence(exercise.name, inRange, units, style, today, inRange.length === all.length),
      chart: chartModel(exercise.name, inRange, style, units, today),
      sessions: heaviestSessionRows(all, units, style, today).slice(0, 5),
    };
  }, [exercise, hub.data, range, units, today]);
  const readout = view && view.chart.points.length > 0 ? (view.chart.points[Math.min(picked ?? view.chart.points.length - 1, view.chart.points.length - 1)]?.label ?? '') : '';

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader title="Strength" offline={hub.status === 'offline' && hub.data !== null} />
        <LoadState status={hub.status} hasData={hub.data !== null} onRetry={pull.onRefresh} busy={pull.refreshing} />

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

            {/* Side by side; one column at large text sizes so neither number is squeezed. */}
            <View style={[stacked ? null : styles.tiles, { gap: space[3] }]}>
              <View
                testID="strength-value"
                accessible
                accessibilityLabel={`Heaviest weight: ${view.stats.heaviest ?? 'none'}${view.stats.change ? `, ${view.stats.change.text}` : ''}`}
                style={[styles.tile, !stacked && styles.half, { borderRadius: radius.card, padding: space[3.5], gap: space[1] }]}
              >
                <Text style={text('caption')}>Heaviest weight</Text>
                <Text style={text('bigNumber')} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.4}>
                  {view.stats.heaviest ?? '–'}
                </Text>
                {view.stats.change ? <Text style={[text('sectionHeading'), styles.change]}>{view.stats.change.text}</Text> : null}
              </View>
              <View
                testID="strength-e1rm"
                accessible
                accessibilityLabel={`Estimated 1-rep max: ${view.stats.e1rm ?? 'none'}, ${view.stats.e1rmDetail}`}
                style={[styles.tile, !stacked && styles.half, { borderRadius: radius.card, padding: space[3.5], gap: space[1] }]}
              >
                <Text style={text('caption')}>Estimated 1-rep max</Text>
                <Text style={text('bigNumber')} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.4}>
                  {view.stats.e1rm ?? '–'}
                </Text>
                <Text style={text('caption')}>{view.stats.e1rmDetail}</Text>
              </View>
            </View>
            <Text style={text('body')} testID="strength-summary">
              {view.line}
            </Text>

            <InkCard>
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

            {view.sessions.length > 0 ? (
              <View style={{ gap: space[2] }}>
                <Text style={text('sectionHeading')} accessibilityRole="header">
                  Recent sessions
                </Text>
                {view.sessions.map((s) => (
                  <View
                    key={s.key}
                    accessible
                    accessibilityLabel={s.label}
                    testID={`strength-session-${s.key}`}
                    style={[styles.session, { borderRadius: radius.input + 2, paddingHorizontal: space[3.5], paddingVertical: space[2.5], gap: space[2.5] }]}
                  >
                    <View style={styles.grow}>
                      <Text style={text('sectionHeading')}>{s.set}</Text>
                      <Text style={text('caption')}>{s.meta}</Text>
                    </View>
                    {s.heaviestYet ? (
                      <Text style={[text('caption'), styles.yetTag, { borderRadius: radius.pill, paddingHorizontal: space[2] }]} testID="strength-heaviest-yet">
                        Heaviest yet
                      </Text>
                    ) : null}
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
  tiles: { flexDirection: 'row' },
  tile: { backgroundColor: palette.surface },
  half: { flex: 1, minWidth: 0 },
  change: { color: palette.magentaDeep },
  session: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget.min, borderWidth: borderWidth.card, borderColor: palette.border },
  yetTag: { color: palette.magentaDeep, backgroundColor: palette.pink, overflow: 'hidden', paddingVertical: 2 },
});
