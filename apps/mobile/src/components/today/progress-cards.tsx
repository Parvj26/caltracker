import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { localToday, recentPrAmount, type Units } from '@caltracker/shared';
import { Sticker } from '@/components/stickers/sticker';
import { fetchAlbum, readCachedAlbum } from '@/lib/album-api';
import { formatEarned } from '@/lib/album-logic';
import { fetchMyProgress, readCachedProgress } from '@/lib/body-api';
import { buildProgress } from '@/lib/progress';
import { useSession } from '@/lib/session';
import { fetchRecentPrs, readCachedPrs } from '@/lib/today-api';
import { goalCard, zooHref, zooSummary } from '@/lib/today-logic';
import { useCachedLoad } from '@/lib/use-cached-load';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Note, Overline, ProgressBar, Row, Tile, useStacked } from './parts';

const STICKER_SIZE = 64;

/** "Newest sticker" and "New PRs · 7 days", side by side (stacked with large text). */
export function StickerAndPrs({ units, refreshKey }: { units: Units; refreshKey: number }) {
  const { space } = useTheme();
  const stacked = useStacked();
  return (
    <View style={[stacked ? styles.column : styles.row, { gap: space[3] }]}>
      <StickerTile refreshKey={refreshKey} half={!stacked} />
      <PrsTile units={units} refreshKey={refreshKey} half={!stacked} />
    </View>
  );
}

function StickerTile({ refreshKey, half }: { refreshKey: number; half: boolean }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const album = useCachedLoad(
    userId && workspaceId ? `${userId}:${workspaceId}` : null,
    () => (userId && workspaceId ? readCachedAlbum(userId, workspaceId) : Promise.resolve(null)),
    () => (userId && workspaceId ? fetchAlbum(userId, workspaceId) : Promise.resolve({ awards: [], stats: null })),
    refreshKey,
  );
  const zoo = useMemo(() => (album.data ? zooSummary(album.data.awards) : null), [album.data]);
  const newest = zoo?.newest ?? null;
  const label = newest
    ? `Newest sticker: ${newest.name}${newest.shiny ? ', shiny' : ''}, earned ${formatEarned(newest.earnedAt)}. ${zoo?.label ?? ''}`
    : zoo
      ? `No stickers yet. ${zoo.label}`
      : 'Newest sticker';

  return (
    <Tile tone="celebrateBg" style={half ? styles.half : undefined} onPress={() => router.navigate(zooHref())} accessibilityLabel={label} accessibilityHint="Opens your zoo book" testID="today-sticker">
      <Overline>Newest sticker</Overline>
      {zoo === null && album.status === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading your stickers" /> : null}
      {zoo === null && album.status === 'offline' ? <Text style={text('body')}>Your stickers show when you’re online.</Text> : null}
      {zoo && newest ? (
        <>
          <View style={styles.tilt}>
            <Sticker stickerKey={newest.key} size={STICKER_SIZE} shiny={newest.shiny} variant="sm" />
          </View>
          <View style={{ gap: space[1] }}>
            <Text style={text('sectionHeading')} testID="today-sticker-name">
              {newest.name}
            </Text>
            <Text style={[text('caption'), styles.ink]}>{formatEarned(newest.earnedAt)}</Text>
          </View>
        </>
      ) : null}
      {zoo && !newest ? <Text style={text('body')}>Finish a workout to earn your first sticker.</Text> : null}
      {zoo ? (
        <View style={{ gap: space[2] }}>
          <Text style={[text('body'), styles.ink]} testID="today-zoo-count">
            {zoo.label}
          </Text>
          <ProgressBar fraction={zoo.fraction} />
        </View>
      ) : null}
    </Tile>
  );
}

function PrsTile({ units, refreshKey, half }: { units: Units; refreshKey: number; half: boolean }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const prs = useCachedLoad(
    userId && workspaceId ? `${userId}:${workspaceId}` : null,
    () => (userId && workspaceId ? readCachedPrs(userId, workspaceId) : Promise.resolve(null)),
    () => (userId && workspaceId ? fetchRecentPrs(userId, workspaceId) : Promise.resolve([])),
    refreshKey,
  );
  const list = prs.data ?? [];
  const label =
    prs.data === null
      ? 'New personal bests in the last 7 days'
      : list.length === 0
        ? 'New personal bests in the last 7 days: none this week yet'
        : `New personal bests in the last 7 days: ${list.map((p) => `${p.name}, ${recentPrAmount(p, units)}`).join('; ')}`;

  return (
    <Tile style={half ? styles.half : undefined} onPress={() => router.navigate('/progress')} accessibilityLabel={label} accessibilityHint="Opens Progress" testID="today-prs">
      <Overline>New PRs · 7 days</Overline>
      {prs.data === null && prs.status === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading personal bests" /> : null}
      {prs.data === null && prs.status === 'offline' ? <Note>Your PRs show when you’re online.</Note> : null}
      {prs.data !== null && list.length === 0 ? <Note testID="today-prs-empty">None this week yet.</Note> : null}
      {list.map((p) => (
        <View key={p.exerciseId} style={{ gap: space[1] / 2 }} testID={`today-pr-${p.exerciseId}`}>
          <Text style={text('sectionHeading')} numberOfLines={2}>
            {p.name}
          </Text>
          <Text style={text('screenTitle')}>{recentPrAmount(p, units)}</Text>
        </View>
      ))}
    </Tile>
  );
}

/**
 * "Your goal": the coach's goal and its countdown, and the latest weight, body fat and muscle with their 3-month
 * change (the same model as the Progress tab). Hidden with no goal and no scans. Opens Progress.
 * `foodSlot` shows today's food (kcal and protein against target, from the Food tab).
 */
export function GoalCard({ units, refreshKey, foodSlot = null }: { units: Units; refreshKey: number; foodSlot?: ReactNode }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const stacked = useStacked();
  const userId = useSession().session?.user.id ?? null;
  const progress = useCachedLoad(
    userId,
    () => (userId ? readCachedProgress(userId) : Promise.resolve(null)),
    fetchMyProgress,
    refreshKey,
  );
  const card = useMemo(
    () => (progress.data ? goalCard(buildProgress(progress.data, 'all', units, localToday())) : null),
    [progress.data, units],
  );

  // Loading, or nothing saved and no signal: say nothing rather than flash a card that may turn out empty.
  if (!card) return null;

  const label = [
    card.goal ? `Your goal: ${card.goal}` : 'Your body',
    card.countdown,
    ...card.tiles.map((t) => `${t.label} ${t.value}${t.change ? `, ${t.change} in 3 months` : ''}`),
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Tile onPress={() => router.navigate('/progress')} accessibilityLabel={label} accessibilityHint="Opens Progress" testID="today-goal">
      <Row style={[styles.baseline, { gap: space[2] }]}>
        <Text style={[text('sectionHeading'), styles.flex]} accessibilityRole="header">
          {card.goal ? 'Your goal' : 'Your body'}
        </Text>
        {card.countdown ? (
          <Text style={text('sectionHeading')} testID="today-goal-countdown">
            {card.countdown}
          </Text>
        ) : null}
      </Row>
      {card.goal ? (
        <Text style={text('body')} testID="today-goal-text">
          {card.goal}
        </Text>
      ) : null}
      {card.tiles.length > 0 ? (
        <View style={[stacked ? styles.column : styles.row, { gap: space[2] }]}>
          {card.tiles.map((t) => (
            <Tile key={t.key} tone="bg" compact style={stacked ? undefined : styles.third} testID={`today-body-${t.key}`}>
              <Text style={text('caption')}>{t.label}</Text>
              <Text style={text('sectionHeading')}>{t.value}</Text>
              {t.change ? <Text style={[text('caption'), styles.ink]}>{t.change}</Text> : null}
            </Tile>
          ))}
        </View>
      ) : null}
      {/* Today's food from the Food tab (TodayFood). */}
      {foodSlot}
    </Tile>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flexDirection: 'column' },
  half: { flex: 1, minWidth: 0 },
  third: { flex: 1, minWidth: 0 },
  flex: { flex: 1 },
  baseline: { alignItems: 'baseline' },
  ink: { color: palette.ink },
  tilt: { alignSelf: 'flex-start', transform: [{ rotate: '-4deg' }] },
});
