import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import {
  bestsTile,
  bodyTile,
  consistencyTile,
  currentProgramLabel,
  foodPeriodDays,
  foodPeriodSummary,
  foodTile,
  localToday,
  personalBestRows,
  plannedDonePercent,
  prsThisWeek,
  strengthTile,
  thisWeekSummary,
  zooTile,
  addDays,
  startOfWeek,
} from '@caltracker/shared';
import { OfflineNote, StatBox } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { buildProgress } from '@/lib/progress';
import { deviceZone } from '@/lib/progress-hub-api';
import { addedDays, trainedDays } from '@/lib/progress-hub-logic';
import { streakNow } from '@/lib/progress-view';
import { useSession } from '@/lib/session';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useAlbum, useBody, useFoodRange, useHub, usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { zooHref } from '@/lib/zoo-href';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type TileTone = 'bg' | 'celebrateBg' | 'drop';
type TileModel = { key: string; title: string; value: string; sub: string; href: Href; tone: TileTone; testID: string };

/**
 * Progress: this week at a glance (workouts, new PRs, streak and a line of encouragement), the coach's goal, then one
 * tile per section (Strength, Body, Personal bests, Consistency, Food, Zoo book), each with its key number. Every
 * number is the copy saved on the phone first, so it shows with no signal.
 */
export default function ProgressScreen() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const userId = useSession().session?.user.id ?? null;
  const units = useUnits() ?? 'lb';
  const coach = useCoachProfile();
  const { refreshKey, refreshing, onRefresh } = usePullRefresh();
  const hub = useHub(refreshKey);
  const album = useAlbum(refreshKey);
  const body = useBody(refreshKey);
  const food = useFoodRange(refreshKey);
  const today = localToday();
  const offline = [hub, album, body, food].some((l) => l.status === 'offline');

  const model = useMemo(() => {
    const h = hub.data;
    const stats = album.data?.stats ?? null;
    const streak = streakNow(stats, h ? trainedDays(h) : [], today);
    const prs = h && userId ? prsThisWeek(h.prEvents, new Set([userId]), today, deviceZone()) : 0;
    const week = h ? thisWeekSummary({ workouts: h.workouts, addedDays: addedDays(h), prs, streak: streak.current, today }) : null;
    const program = h ? currentProgramLabel(h.assignments, today) : null;
    const bodyModel = body.data ? buildProgress(body.data, '3m', units, today) : null;
    const weight = bodyModel?.latest.find((l) => l.key === 'weight_kg') ?? null;
    const foodWeek = food.data ? foodPeriodSummary(food.data.meals, food.data.targets, foodPeriodDays('week', today), today) : null;
    const eightWeeksFrom = addDays(startOfWeek(today), -49);
    const tiles: TileModel[] = [
      { key: 'strength', title: 'Strength', ...(h ? strengthTile(h.exercises, units, today) : loading), href: '/progress-detail/strength', tone: 'bg', testID: 'progress-strength' },
      { key: 'body', title: 'Body', ...(body.data ? bodyTile(weight) : loading), href: '/progress-detail/body', tone: 'bg', testID: 'progress-body' },
      {
        key: 'bests',
        title: 'Personal bests',
        ...(h ? bestsTile(personalBestRows(h.records).length, prs) : loading),
        href: '/progress-detail/bests',
        tone: 'celebrateBg',
        testID: 'progress-bests',
      },
      {
        key: 'consistency',
        title: 'Consistency',
        ...(h
          ? consistencyTile(
              plannedDonePercent(h.workouts, addedDays(h), today),
              trainedDays(h).filter((d) => d >= eightWeeksFrom).length,
            )
          : loading),
        href: '/progress-detail/consistency',
        tone: 'bg',
        testID: 'progress-consistency',
      },
      {
        key: 'food',
        title: 'Food',
        ...(foodWeek
          ? foodTile({ hitDays: foodWeek.hitDays, loggedDays: foodWeek.loggedDays, mealCount: foodWeek.mealCount, hasProteinTarget: foodWeek.proteinDays !== null })
          : loading),
        href: '/progress-detail/food',
        tone: 'bg',
        testID: 'progress-food',
      },
      {
        key: 'zoo',
        title: 'Zoo book',
        ...(album.data ? zooTile(album.data.awards.length, stats?.lifetimeVolumeKg ?? 0, units) : loading),
        href: zooHref(),
        tone: 'drop',
        testID: 'progress-zoo',
      },
    ];
    return { week, program, goal: bodyModel?.goal ?? null, tiles };
  }, [hub.data, album.data, body.data, food.data, units, today, userId]);

  const coachName = coach?.name.split(' ')[0] ?? 'your coach';

  return (
    <Screen
      inTabs
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={{ gap: space[3.5] }}>
      <Text style={text('screenTitle')} accessibilityRole="header">
        Progress
      </Text>
      <OfflineNote show={offline} />

      <View testID="progress-week" style={[styles.week, { borderRadius: radius.card, padding: space[3.5], gap: space[2.5] }]}>
        <View style={[styles.weekHead, { gap: space[2] }]}>
          <Text style={[text('sectionHeading'), styles.overline]} accessibilityRole="header">
            This week
          </Text>
          {model.program ? (
            <Text style={[text('sectionHeading'), styles.small]} testID="progress-program">
              {model.program}
            </Text>
          ) : null}
        </View>
        <View style={[styles.row, { gap: space[2] }]}>
          <StatBox tone="bg" value={model.week?.workoutsValue ?? '–'} label="workouts" testID="week-workouts" />
          <StatBox tone="bg" value={String(model.week?.prs ?? 0)} label="new PRs" testID="week-prs" />
          <StatBox tone="bg" value={`${model.week?.streak ?? 0} wk`} label="streak" testID="week-streak" />
        </View>
        <Text style={text('sectionHeading')} testID="week-sentence" accessibilityLiveRegion="polite">
          {model.week?.sentence ?? ' '}
        </Text>
      </View>

      {model.goal ? (
        <View
          testID="progress-goal"
          style={[styles.goal, { borderRadius: radius.card - 2, padding: space[3], gap: space[2.5] }]}
        >
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

      <View style={[styles.grid, { gap: space[2.5] }]}>
        {model.tiles.map((t) => (
          <Pressable
            key={t.key}
            testID={t.testID}
            onPress={() => router.push(t.href)}
            accessibilityRole="button"
            accessibilityLabel={`${t.title}: ${t.value}, ${t.sub}`}
            accessibilityHint={`Opens ${t.title}`}
            style={({ pressed }) => [
              styles.tile,
              { borderRadius: radius.card - 2, padding: space[3], gap: space[1], backgroundColor: palette[t.tone] },
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <View style={styles.tileHead}>
              <Text style={[text('sectionHeading'), styles.small]}>{t.title}</Text>
              <Text style={text('sectionHeading')} accessibilityElementsHidden importantForAccessibility="no">
                ›
              </Text>
            </View>
            <Text style={[text('sectionHeading'), styles.tileValue]} numberOfLines={2}>
              {t.value}
            </Text>
            <Text style={text('caption')} numberOfLines={2}>
              {t.sub}
            </Text>
          </Pressable>
        ))}
      </View>
      </View>
    </Screen>
  );
}

const loading = { value: '…', sub: 'Loading' };

const styles = StyleSheet.create({
  week: { backgroundColor: palette.lime, borderWidth: borderWidth.card, borderColor: palette.ink },
  weekHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' },
  overline: { textTransform: 'uppercase', letterSpacing: 0.6 },
  small: { fontSize: 13 },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
  goal: { flexDirection: 'row', alignItems: 'center', borderWidth: borderWidth.card, borderColor: palette.ink },
  chip: { backgroundColor: palette.drop, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, overflow: 'hidden', paddingVertical: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '48.5%', flexGrow: 1, flexBasis: '45%', minHeight: 104, borderWidth: borderWidth.card, borderColor: palette.ink },
  tileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tileValue: { fontSize: 20, lineHeight: 24 },
});
