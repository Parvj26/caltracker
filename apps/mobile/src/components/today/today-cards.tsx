// The redesigned Today's cards (approved boards 1 and 2: workout day and rest day). Each card below the workout loads
// its own data (from the phone's copy first), so one slow read never holds up the rest.
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { formatLogDuration, localToday, thisWeekSummary, type Units, type WorkoutDoc } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { Sticker } from '@/components/stickers/sticker';
import { Button, TextButton } from '@/components/ui';
import type { WorkoutStatus } from '@/lib/active-log-logic';
import { addedDays, trainedDays } from '@/lib/progress-hub-logic';
import { streakNow } from '@/lib/progress-view';
import { useSession } from '@/lib/session';
import { fetchLatestPosts, readCachedPosts } from '@/lib/today-api';
import {
  agoText,
  coachPreview,
  communityHeadline,
  foodCard,
  newCountLabel,
  nextUpDay,
  postPreview,
  programChip,
  unreadLabel,
  weekTile,
  workoutMeta,
  zooHref,
  zooSummary,
  type FoodBar,
} from '@/lib/today-logic';
import { useCachedLoad } from '@/lib/use-cached-load';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useCommunity } from '@/lib/use-community';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { useFood } from '@/lib/use-food';
import { useMessages } from '@/lib/use-messages';
import { useAlbum, useHub } from '@/lib/use-progress-data';
import type { WorkoutSummary } from '@/lib/workouts';
import { muscleTags, planTotals } from '@/lib/workouts-plan';
import { palette, pressedOpacity, radius, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Overline, useStacked } from './parts';

/** The hero cards' corner (a little rounder than the other cards, as on the boards). */
export const HERO_RADIUS = 22;
const HERO_SHADOW = 4;
const STICKER = 48;
/** Between the lines of the small tiles (6 pt, as on the boards). */
const TILE_GAP = 6;
const ADD_MEAL_HEIGHT = tapTarget.min - 4;

/**
 * The coach chat. The Coach tab redesign (feature/coach-tab-redesign, merging before this) makes /coach the coach's
 * profile and /coach/chat the chat; until it is on this branch the route does not exist yet, hence the cast.
 */
export const COACH_CHAT_HREF = '/coach/chat' as Href;

/** Where Preview goes: the Workouts tab's Preview screen (plan, totals and a sticky Start). */
export const previewHref = (id: string): Href => ({ pathname: '/plan/[id]', params: { id } });

/** A big bordered card with a hard ink shadow (the workout, rest day and new-client coach cards). */
export function Hero({ tone, children, testID }: { tone: 'lime' | 'blue' | 'drop'; children: ReactNode; testID?: string }) {
  const { space } = useTheme();
  return (
    <View testID={testID} style={[styles.hero, { backgroundColor: palette[tone], padding: space[4.5], gap: space[2.5] }]}>
      {children}
    </View>
  );
}

// ---- Today's workout ---------------------------------------------------------------------------------------

export function WorkoutCard({
  workout,
  doc,
  status,
  starting,
  onStart,
  onView,
}: {
  workout: WorkoutSummary;
  /** The whole plan, once read (for the time and muscle groups); null meanwhile. */
  doc: WorkoutDoc | null;
  status: WorkoutStatus | null;
  starting: boolean;
  onStart: () => void;
  /** Opens the finished workout's summary. */
  onView: (logId: string) => void;
}) {
  const { text, space } = useTheme();
  const router = useRouter();
  const stacked = useStacked();
  const exerciseIds = useMemo(() => doc?.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)) ?? [], [doc]);
  const details = useExerciseDetails(exerciseIds);
  const totals = doc ? planTotals(doc) : null;
  const meta = workoutMeta(totals?.exercises ?? workout.exerciseCount, totals?.minutes ?? null, muscleTags(exerciseIds, details));
  const chip = programChip(workout.programDay ?? null);

  return (
    <Hero tone="lime" testID={`today-workout-${workout.id}`}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Overline>Today’s workout</Overline>
        </View>
        {chip ? (
          <View style={[styles.chip, { paddingHorizontal: space[2], paddingVertical: space[1] / 2 }]}>
            <Text style={[text('caption'), styles.chipText]} accessibilityLabel={`Program ${workout.programName ?? ''}, ${chip}`}>
              {chip}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[text('screenTitle'), styles.heroTitle]} accessibilityRole="header">
        {workout.name}
      </Text>
      <Text style={[text('body'), styles.meta]} testID={`today-meta-${workout.id}`}>
        {meta}
      </Text>
      {status?.kind === 'done' ? (
        <Text testID={`done-${workout.id}`} style={text('sectionHeading')}>
          {`Done ✓ · ${formatLogDuration(status.durationS)}`}
        </Text>
      ) : null}
      <View style={[stacked ? styles.column : styles.row, { gap: space[2.5], marginTop: space[1] }, !stacked && styles.top]}>
        <View style={stacked ? undefined : styles.flex}>
          {status?.kind === 'done' ? (
            <Button title="View summary" testID={`view-log-${workout.id}`} onPress={() => onView(status.logId)} />
          ) : (
            <Button
              title={status?.kind === 'in_progress' ? 'Resume' : 'Start workout'}
              testID={`start-${workout.id}`}
              ph-label="log_start_workout"
              onPress={onStart}
              busy={starting}
            />
          )}
        </View>
        <Button variant="secondary" title="Preview" testID={`view-workout-${workout.id}`} onPress={() => router.push(previewHref(workout.id))} />
      </View>
    </Hero>
  );
}

// ---- Rest day ----------------------------------------------------------------------------------------------

export function RestCard({ next, today, onLogAnyway }: { next: WorkoutSummary | null; today: string; onLogAnyway: () => void }) {
  const { text, space } = useTheme();
  const router = useRouter();
  return (
    <Hero tone="blue" testID="today-rest">
      <Overline>Rest day</Overline>
      <Text style={[text('screenTitle'), styles.restTitle]} accessibilityRole="header">Recover well. Muscles grow on rest days.</Text>
      {next ? (
        <View style={[styles.row, styles.nextBox, { gap: space[2.5], padding: space[3], marginTop: space[1] }]} testID="today-next">
          <View style={styles.flex}>
            <Text style={[text('caption'), styles.nextDay]}>{`Next up · ${nextUpDay(next.scheduledOn, today)}`}</Text>
            <Text style={[text('sectionHeading'), styles.nextName]} numberOfLines={2}>
              {next.name}
            </Text>
          </View>
          <Pressable
            testID="today-next-preview"
            onPress={() => router.push(previewHref(next.id))}
            accessibilityRole="button"
            accessibilityLabel={`Preview ${next.name}`}
            style={({ pressed }) => [styles.smallButton, { paddingHorizontal: space[3.5] }, pressed && styles.pressed]}
          >
            <Text style={text('sectionHeading')}>Preview</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.start}>
        <TextButton title="Log a workout anyway" testID="today-log-anyway" onPress={onLogAnyway} />
      </View>
    </Hero>
  );
}

// ---- Food today --------------------------------------------------------------------------------------------

export function FoodCard({ refreshKey }: { refreshKey: number }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const food = useFood();
  const today = localToday();
  const loadDay = food?.loadDay;
  useEffect(() => {
    void loadDay?.(today);
  }, [loadDay, today, refreshKey]);
  const meals = food?.mealsOn(today);
  const card = useMemo(() => (meals ? foodCard(meals, food?.targets ?? null) : null), [meals, food?.targets]);
  if (!card) return null;

  return (
    <View testID="today-food" style={[styles.outlined, { borderRadius: radius.card, padding: space[4], gap: space[2.5] }]}>
      <View style={[styles.row, { gap: space[2] }]}>
        <Text style={[text('sectionHeading'), styles.cardTitle, styles.flex]} accessibilityRole="header">
          Food today
        </Text>
        <Pressable
          testID="today-add-meal"
          ph-label="log_add_meal"
          onPress={() => router.push({ pathname: '/food/meal', params: { day: today } })}
          accessibilityRole="button"
          accessibilityLabel="Add meal"
          // 40 pt on screen as on the board; the slop makes the tap area 44.
          hitSlop={2}
          style={({ pressed }) => [styles.addMeal, { paddingHorizontal: space[3.5] }, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>+ Add meal</Text>
        </Pressable>
      </View>
      <View style={[styles.row, styles.top, { gap: space[2.5] }]}>
        <Bar name="Calories" bar={card.calories} testID="today-food-calories" />
        <Bar name="Protein" bar={card.protein} testID="today-food-protein" />
      </View>
      <Text style={[text('caption'), styles.mealsLine]} numberOfLines={2} testID="today-food-meals">
        {card.meals}
      </Text>
    </View>
  );
}

function Bar({ name, bar, testID }: { name: string; bar: FoodBar; testID: string }) {
  const { text, space } = useTheme();
  return (
    <View style={[styles.flex, { gap: space[1] }]} testID={testID} accessible accessibilityLabel={bar.label}>
      <Text style={[text('caption'), styles.barLabel]}>
        {name} <Text style={[text('caption'), styles.barValue]}>{bar.value}</Text>
      </Text>
      {bar.fraction !== null ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(bar.fraction * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

// ---- Latest coach message ----------------------------------------------------------------------------------

export function CoachMessageCard() {
  const { text, space } = useTheme();
  const router = useRouter();
  const chat = useMessages();
  const coach = useCoachProfile();
  const preview = useMemo(() => (chat ? coachPreview(chat.items, chat.me) : null), [chat]);
  // No coach chat (no coach link): there is no Coach tab either.
  if (!chat) return null;

  const first = coach?.name?.trim().split(/\s+/)[0] || 'Your coach';
  const ago = preview ? agoText(preview.at, new Date()) : null;
  const line =
    preview?.text ??
    (chat.status === 'loading' ? 'Loading messages…' : chat.status === 'offline' ? 'Messages show when you’re online.' : `Say hi to ${first}`);
  const unread = unreadLabel(chat.unread);
  const label = [first, ago, line, unread].filter(Boolean).join('. ');

  return (
    <Pressable
      testID="today-coach"
      onPress={() => router.navigate(COACH_CHAT_HREF)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens your chat with your coach"
      style={({ pressed }) => [styles.row, styles.quiet, { borderRadius: radius.card, padding: space[3.5], gap: space[3] }, pressed && styles.pressed]}
    >
      <CoachAvatar name={coach?.name || 'Coach'} url={coach?.avatarUrl ?? null} size={44} ring={2} />
      <View style={[styles.flex, { gap: space[1] / 2 }]}>
        <Text style={text('sectionHeading')} numberOfLines={1}>
          {first}
          {ago ? <Text style={[text('caption'), styles.ago]}>{` · ${ago}`}</Text> : null}
        </Text>
        <Text style={text('body')} numberOfLines={2} testID="today-coach-preview">
          {line}
        </Text>
      </View>
      {chat.unread > 0 ? <View style={styles.dot} testID="today-coach-unread" /> : null}
    </Pressable>
  );
}

// ---- This week and Newest sticker --------------------------------------------------------------------------

export function WeekAndSticker({ refreshKey }: { refreshKey: number }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const stacked = useStacked();
  const today = localToday();
  // The same data and week summary as the Progress tab's This week card, so the two always agree.
  const hub = useHub(refreshKey);
  const album = useAlbum(refreshKey);
  const tile = useMemo(() => {
    const h = hub.data;
    if (!h) return null;
    const streak = streakNow(album.data?.stats ?? null, trainedDays(h), today);
    return weekTile(thisWeekSummary({ workouts: h.workouts, addedDays: addedDays(h), prs: 0, streak: streak.current, today }));
  }, [hub.data, album.data, today]);
  const zoo = useMemo(() => (album.data ? zooSummary(album.data.awards) : null), [album.data]);
  const newest = zoo?.newest ?? null;
  const half: StyleProp<ViewStyle> = stacked ? undefined : styles.flex;

  return (
    <View style={[stacked ? styles.column : styles.row, styles.stretch, { gap: space[2.5] }]}>
      <Pressable
        testID="today-week"
        onPress={() => router.navigate('/progress')}
        accessibilityRole="button"
        accessibilityLabel={tile ? `This week: ${tile.big} ${tile.small}` : 'This week'}
        accessibilityHint="Opens Progress"
        style={({ pressed }) => [styles.tile, styles.weekTile, { padding: space[3.5], gap: TILE_GAP }, half, pressed && styles.pressed]}
      >
        <Overline>This week</Overline>
        {tile ? (
          <>
            <Text style={[text('bigNumber'), styles.weekBig]}>{tile.big}</Text>
            <Text style={[text('caption'), styles.ink]}>{tile.small}</Text>
          </>
        ) : hub.status === 'loading' ? (
          <ActivityIndicator color={palette.ink} accessibilityLabel="Loading this week" />
        ) : (
          <Text style={[text('caption'), styles.ink]}>Shows when you’re online.</Text>
        )}
      </Pressable>
      <Pressable
        testID="today-sticker"
        onPress={() => router.navigate(zooHref())}
        accessibilityRole="button"
        accessibilityLabel={newest ? `Newest sticker: ${newest.name}${newest.shiny ? ', shiny' : ''}. ${zoo?.label ?? ''}` : 'Newest sticker: none yet'}
        accessibilityHint="Opens your zoo book"
        style={({ pressed }) => [styles.tile, { padding: space[3.5], gap: TILE_GAP }, half, pressed && styles.pressed]}
      >
        <Overline>Newest sticker</Overline>
        {newest ? (
          <View style={[styles.row, { gap: space[2] }]}>
            <View style={[styles.stickerBox, styles.tilt]}>
              <Sticker stickerKey={newest.key} size={STICKER - 8} shiny={newest.shiny} variant="sm" />
            </View>
            <Text style={[text('sectionHeading'), styles.flex]} numberOfLines={2} testID="today-sticker-name">
              {newest.name}
            </Text>
          </View>
        ) : zoo ? (
          <Text style={[text('caption'), styles.ink]}>None yet. Finish a workout to earn one.</Text>
        ) : album.status === 'loading' ? (
          <ActivityIndicator color={palette.ink} accessibilityLabel="Loading your stickers" />
        ) : (
          <Text style={[text('caption'), styles.ink]}>Shows when you’re online.</Text>
        )}
      </Pressable>
    </View>
  );
}

// ---- Community peek ----------------------------------------------------------------------------------------

export function CommunityPeek({ units, refreshKey }: { units: Units; refreshKey: number }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const me = useSession().session?.user.id ?? null;
  const { community, ready, removed, coaches, blocked, unread } = useCommunity();
  const communityId = community?.id ?? null;
  const posts = useCachedLoad(
    me && communityId ? `${me}:${communityId}` : null,
    () => (me && communityId ? readCachedPosts(me, communityId) : Promise.resolve(null)),
    () => (me && communityId ? fetchLatestPosts(me, communityId, blocked) : Promise.resolve([])),
    refreshKey,
  );
  const headline = useMemo(() => {
    const newest = posts.data?.find((p) => !blocked.has(p.authorId));
    if (!posts.data || !me) return null;
    return newest ? communityHeadline(postPreview(newest, { me, coaches, units })) : 'No posts yet. Say hello!';
  }, [posts.data, me, blocked, coaches, units]);

  // No community (none, or taken out by the coach): nothing here; the Community screen explains.
  if (ready && (removed || !community)) return null;
  // Still loading: the line's shape, so the page doesn't jump when it arrives.
  if (!ready || !community) {
    return (
      <View testID="today-community-loading" style={[styles.row, styles.quiet, styles.peek, { paddingHorizontal: space[4] }]}>
        <Text style={[text('sectionHeading'), styles.flex]}>Community</Text>
      </View>
    );
  }
  const badge = newCountLabel(unread);
  const line = headline ? `Community · ${headline}` : 'Community';

  return (
    <Pressable
      testID="today-community"
      onPress={() => router.push('/community')}
      accessibilityRole="button"
      accessibilityLabel={[line, badge].filter(Boolean).join('. ')}
      accessibilityHint="Opens the community"
      style={({ pressed }) => [styles.row, styles.quiet, styles.peek, { paddingHorizontal: space[4], gap: space[2.5] }, pressed && styles.pressed]}
    >
      <Text style={[text('sectionHeading'), styles.flex]} numberOfLines={1} testID="today-community-line">
        {line}
      </Text>
      {badge ? (
        <View style={[styles.newBadge, { paddingHorizontal: space[2], paddingVertical: space[1] / 2 }]}>
          <Text style={[text('caption'), styles.newText]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  column: { flexDirection: 'column' },
  top: { alignItems: 'flex-start' },
  stretch: { alignItems: 'stretch' },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  pressed: { opacity: pressedOpacity },
  ink: { color: palette.ink },
  hero: {
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    borderRadius: HERO_RADIUS,
    shadowColor: palette.ink,
    shadowOffset: { width: 0, height: HERO_SHADOW },
    shadowOpacity: 1,
    shadowRadius: 0,
    marginBottom: HERO_SHADOW,
  },
  // No fixed line height: it would clip the text at large Dynamic Type sizes.
  heroTitle: { fontSize: 30 },
  restTitle: { fontSize: 26 },
  meta: { color: palette.ink },
  chip: { backgroundColor: palette.bg, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, borderRadius: radius.pill },
  chipText: { color: palette.ink, fontSize: 12 },
  nextBox: { backgroundColor: palette.bg, borderWidth: borderWidth.card, borderColor: palette.ink, borderRadius: 16 },
  nextDay: { color: palette.inkMuted },
  nextName: { fontSize: 17 },
  outlined: { borderWidth: borderWidth.card, borderColor: palette.ink },
  quiet: { borderWidth: borderWidth.card, borderColor: palette.border },
  cardTitle: { fontSize: 18 },
  addMeal: {
    minHeight: ADD_MEAL_HEIGHT,
    borderRadius: 14,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.drop,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barLabel: { color: palette.ink, fontSize: 13 },
  barValue: { color: palette.inkMuted, fontSize: 13 },
  track: { height: 10, borderRadius: 5, backgroundColor: palette.surface, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: palette.lime },
  mealsLine: { color: palette.inkMuted, fontSize: 13 },
  ago: { color: palette.inkMuted },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.magenta },
  tile: { borderWidth: borderWidth.card, borderColor: palette.ink, borderRadius: 20, backgroundColor: palette.bg },
  weekTile: { backgroundColor: palette.celebrateBg },
  weekBig: { fontSize: 22 },
  tilt: { transform: [{ rotate: '-4deg' }] },
  stickerBox: {
    width: STICKER,
    height: STICKER,
    borderRadius: 12,
    backgroundColor: palette.drop,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  smallButton: {
    minHeight: tapTarget.min,
    borderRadius: 14,
    borderWidth: borderWidth.secondaryButton,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peek: { minHeight: 56, borderRadius: 18 },
  newBadge: { backgroundColor: palette.ink, borderRadius: radius.pill },
  newText: { color: white, fontSize: 12 },
});
