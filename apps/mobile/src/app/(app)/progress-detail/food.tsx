import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { FOOD_PERIOD_LABELS, foodPeriodDays, foodPeriodSummary, localToday, type FoodPeriod } from '@caltracker/shared';
import { InkCard, LoadState, OfflineNote, Overline, SectionHeader, Segmented } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useFoodRange, usePullRefresh } from '@/lib/use-progress-data';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const DOT = 36;
const PERIODS: FoodPeriod[] = ['week', '4w'];

/**
 * Food: this week or the last 4 weeks. The daily average of calories, protein, carbs and fat against the coach's
 * targets (averages alone when none are set), the days that reached the protein target, and how many meals were logged.
 */
export default function FoodProgressScreen() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const coach = useCoachProfile();
  const pull = usePullRefresh();
  const food = useFoodRange(pull.refreshKey);
  const [period, setPeriod] = useState<FoodPeriod>('week');
  const today = localToday();
  const s = useMemo(
    () => (food.data ? foodPeriodSummary(food.data.meals, food.data.targets, foodPeriodDays(period, today), today) : null),
    [food.data, period, today],
  );
  const coachName = coach?.name.split(' ')[0];
  const periodWords = period === 'week' ? 'this week' : 'in the last 4 weeks';

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader title="Food" />
        <OfflineNote show={food.status === 'offline' && food.data !== null} />
        <LoadState status={food.status} hasData={food.data !== null} onRetry={pull.onRefresh} busy={pull.refreshing} />
        <Segmented
          label="Period"
          testIDPrefix="food-period"
          options={PERIODS.map((p) => ({ key: p, label: FOOD_PERIOD_LABELS[p] }))}
          value={period}
          onChange={setPeriod}
        />
        {s ? (
          <>
            <InkCard style={{ gap: space[3] }}>
              <Overline>{s.hasTargets ? `Daily average vs ${coachName ? `${coachName}’s` : 'your coach’s'} targets` : 'Daily average'}</Overline>
              {s.macros.map((m) => (
                <View key={m.key} style={{ gap: space[1] }} accessible accessibilityLabel={m.label} testID={`food-macro-${m.key}`}>
                  <View style={styles.between}>
                    <Text style={text('sectionHeading')}>{m.name}</Text>
                    <Text style={text('sectionHeading')}>{m.text}</Text>
                  </View>
                  {m.fraction !== null ? (
                    <View style={[styles.track, { borderRadius: radius.pill }]}>
                      <View style={[styles.fill, { width: `${Math.round(m.fraction * 100)}%` }, m.fraction >= 0.9 ? styles.fillNear : styles.fillPart]} />
                    </View>
                  ) : null}
                </View>
              ))}
              {!s.hasTargets ? <Text style={text('caption')}>Your coach hasn’t set targets yet, so these are your averages.</Text> : null}
            </InkCard>

            {s.proteinDays ? (
              <View style={[styles.box, { borderRadius: radius.card, padding: space[4], gap: space[2.5] }]}>
                <Text style={text('sectionHeading')} accessibilityRole="header">
                  Protein target
                </Text>
                <View style={styles.dots}>
                  {s.proteinDays.map((d) => (
                    <View key={d.date} style={styles.dotCol}>
                      <View
                        accessible
                        accessibilityRole="image"
                        accessibilityLabel={d.label}
                        testID={`protein-${d.date}`}
                        style={[
                          styles.dot,
                          d.state === 'hit' && styles.dotHit,
                          d.state === 'under' && styles.dotUnder,
                          (d.state === 'none' || d.state === 'future') && styles.dotFaint,
                        ]}
                      >
                        {d.state === 'hit' ? <Text style={text('sectionHeading')}>✓</Text> : null}
                      </View>
                      {period === 'week' ? <Text style={text('caption')}>{d.dow}</Text> : null}
                    </View>
                  ))}
                </View>
                <Text style={text('sectionHeading')} testID="food-sentence">
                  {s.sentence}
                </Text>
              </View>
            ) : (
              <Text style={text('body')} testID="food-sentence">
                {s.sentence}
              </Text>
            )}

            <Pressable
              testID="food-open"
              accessibilityRole="button"
              accessibilityLabel={`${s.mealCount} meals logged ${periodWords}, ${s.photoCount} with photos. Open Food`}
              onPress={() => router.push('/food')}
              style={({ pressed }) => [styles.box, styles.between, { borderRadius: radius.button, padding: space[3], minHeight: tapTarget.min }, pressed && { opacity: pressedOpacity }]}
            >
              <View style={styles.flex}>
                <Text style={text('sectionHeading')}>{`${s.mealCount} ${s.mealCount === 1 ? 'meal' : 'meals'} logged ${periodWords}`}</Text>
                <Text style={text('caption')}>{`${s.photoCount} with photos`}</Text>
              </View>
              <Text style={text('sectionHeading')}>Open Food ›</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flex: { flex: 1 },
  track: { height: 12, backgroundColor: palette.surface, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, overflow: 'hidden' },
  fill: { height: '100%' },
  fillNear: { backgroundColor: palette.ink },
  fillPart: { backgroundColor: palette.lime },
  box: { borderWidth: borderWidth.card, borderColor: palette.border },
  // Seven per row (a week), so the 4-week view is four aligned rows rather than eight-wide rows with a ragged end.
  dots: { flexDirection: 'row', flexWrap: 'wrap' },
  dotCol: { width: '14.28%', alignItems: 'center', gap: 4, marginBottom: 6 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: 'center', justifyContent: 'center', borderWidth: borderWidth.card },
  dotHit: { backgroundColor: palette.lime, borderColor: palette.ink },
  dotUnder: { backgroundColor: palette.bg, borderColor: palette.ink },
  dotFaint: { backgroundColor: palette.bg, borderColor: palette.border },
});
