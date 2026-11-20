import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import {
  bestsRow,
  consistencyRow,
  foodPeriodDays,
  foodPeriodSummary,
  foodTile,
  localToday,
  progressHeadline,
  strengthTile,
  zooRow,
} from '@caltracker/shared';
import { OfflineNote } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { buildProgress } from '@/lib/progress';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { metricsTile } from '@/lib/metrics-view';
import { useProgressFacts } from '@/lib/use-progress-facts';
import { useBody, useFoodRange, useMetrics, usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { zooHref } from '@/lib/zoo-href';
import { palette, pressedOpacity } from '@/theme/theme';
import { fontFamilyFor } from '@/theme/fonts';
import { useTheme } from '@/theme/use-theme';
import { ChevronIcon } from '@/components/ui/icons';

type RowModel = { key: string; title: string; value: string; sub: string; href: Href; testID: string };

/**
 * Progress (approved Progress board, 2026-11-19): the streak and this week in one line, the coach's goal, then one
 * plain row per section (Strength, Metrics, Personal bests, Consistency, Zoo book, Food), each with its key number.
 * The streak, bests, stickers and week come from the shared progressFacts (the same numbers as Today, Consistency and
 * the Zoo book); while the latest workout is still syncing they say "Updating…". Every number is the copy saved on
 * the phone first, so it shows with no signal.
 */
export default function ProgressScreen() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const units = useUnits() ?? 'lb';
  const coach = useCoachProfile();
  const { refreshKey, refreshing, onRefresh } = usePullRefresh();
  const { facts, hub, album } = useProgressFacts(refreshKey);
  const body = useBody(refreshKey);
  const food = useFoodRange(refreshKey);
  const metrics = useMetrics(refreshKey);
  const today = localToday();
  const offline = [hub, album, body, food, metrics].some((l) => l.status === 'offline');

  const model = useMemo(() => {
    const h = hub.data;
    const everTrained = (h?.finished.length ?? 0) > 0;
    const bodyModel = body.data ? buildProgress(body.data, '3m', units, today) : null;
    const foodWeek = food.data ? foodPeriodSummary(food.data.meals, food.data.targets, foodPeriodDays('week', today), today) : null;
    const rows: RowModel[] = [
      { key: 'strength', title: 'Strength', ...(h ? strengthTile(h.exercises, units, today) : loading), href: '/progress-detail/strength', testID: 'progress-strength' },
      { key: 'metrics', title: 'Metrics', ...(metrics.data ? metricsTile(metrics.data, units, today) : loading), href: '/progress-detail/metrics', testID: 'progress-metrics' },
      { key: 'bests', title: 'Personal bests', ...(bestsRow(facts) ?? loading), href: '/progress-detail/bests', testID: 'progress-bests' },
      { key: 'consistency', title: 'Consistency', ...(consistencyRow(facts, everTrained) ?? loading), href: '/progress-detail/consistency', testID: 'progress-consistency' },
      { key: 'zoo', title: 'Zoo book', ...(zooRow(facts) ?? loading), href: zooHref(), testID: 'progress-zoo' },
      {
        key: 'food',
        title: 'Food',
        ...(foodWeek
          ? foodTile({ hitDays: foodWeek.hitDays, loggedDays: foodWeek.proteinLoggedDays, mealCount: foodWeek.mealCount, hasProteinTarget: foodWeek.proteinDays !== null })
          : loading),
        href: '/progress-detail/food',
        testID: 'progress-food',
      },
    ];
    return { headline: progressHeadline(facts, everTrained), goal: bodyModel?.goal ?? null, rows };
  }, [hub.data, body.data, food.data, metrics.data, units, today, facts]);

  const coachName = coach?.name.split(' ')[0] ?? 'your coach';

  return (
    <Screen inTabs refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ gap: space[1] }}>
        <Text style={text('screenTitle')} accessibilityRole="header">
          Progress
        </Text>
        <Text style={text('body')} testID="progress-week" accessibilityLiveRegion="polite">
          {model.headline ? (
            <>
              <Text style={styles.strong}>{model.headline.strong}</Text>
              {model.headline.rest ? ` · ${model.headline.rest}` : ''}
            </>
          ) : (
            ' '
          )}
        </Text>
      </View>
      <OfflineNote show={offline} />

      {model.goal ? (
        <View testID="progress-goal" style={[styles.goal, { borderRadius: radius.card - 2, padding: space[3], gap: space[2.5] }]}>
          <View style={styles.flex}>
            <Text style={[text('caption'), styles.overline]}>{`Goal · set by ${coachName}`}</Text>
            <Text style={text('sectionHeading')} testID="goal-text">
              {model.goal.text}
            </Text>
            {model.goal.date ? (
              <Text style={text('caption')} testID="goal-date">
                {`Target date ${model.goal.date}`}
              </Text>
            ) : null}
          </View>
          {model.goal.countdown ? (
            <Text testID="goal-countdown" style={[text('sectionHeading'), styles.small, styles.chip, { borderRadius: radius.pill, paddingHorizontal: space[2.5] }]}>
              {model.goal.countdown}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.list}>
        {model.rows.map((r) => (
          <Pressable
            key={r.key}
            testID={r.testID}
            onPress={() => router.push(r.href)}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}: ${r.value}, ${r.sub}`}
            accessibilityHint={`Opens ${r.title}`}
            style={({ pressed }) => [styles.row, { gap: space[3], paddingVertical: space[3.5] }, pressed && { opacity: pressedOpacity }]}
          >
            <View style={styles.flex}>
              <Text style={[text('sectionHeading'), styles.rowTitle]}>{r.title}</Text>
              <Text style={[text('sectionHeading'), styles.rowValue]} testID={`${r.testID}-value`}>
                {r.value}
              </Text>
              <Text style={text('caption')} testID={`${r.testID}-sub`}>
                {r.sub}
              </Text>
            </View>
            <ChevronIcon size={16} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const loading = { value: '…', sub: 'Loading' };

const styles = StyleSheet.create({
  strong: { fontFamily: fontFamilyFor('sans', 800) },
  overline: { textTransform: 'uppercase', letterSpacing: 0.6 },
  small: { fontSize: 13 },
  flex: { flex: 1 },
  goal: { flexDirection: 'row', alignItems: 'center', borderWidth: borderWidth.card, borderColor: palette.ink },
  chip: { backgroundColor: palette.drop, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, overflow: 'hidden', paddingVertical: 3 },
  list: { borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 68, borderBottomWidth: 1, borderBottomColor: palette.border },
  rowTitle: { fontSize: 14, color: palette.inkMuted },
  rowValue: { fontSize: 22, lineHeight: 28 },
});
