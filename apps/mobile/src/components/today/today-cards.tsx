// The redesigned Today's cards (approved boards 1 and 2: workout day and rest day). Each card below the workout loads
// its own data (from the phone's copy first), so one slow read never holds up the rest.
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderWidth, tapTarget, typeScale } from '@caltracker/design-tokens';
import {
  formatLogDuration,
  localToday,
  logSetCount,
  setProgressText,
  STICKERS,
  type SetRange,
  type Units,
  type WorkoutDoc,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { Sticker } from '@/components/stickers/sticker';
import { Button, TextButton } from '@/components/ui';
import { CountBadge } from '@/components/ui/count-badge';
import type { WorkoutStatus } from '@/lib/active-log-logic';
import { useSession } from '@/lib/session';
import { fetchLatestPosts, readCachedPosts } from '@/lib/today-api';
import {
  agoText,
  coachPreview,
  communityHeadline,
  doneLine,
  foodLine,
  goalStripDays,
  newCountLabel,
  postPreview,
  programChip,
  restNextLine,
  restPreviewLabel,
  unreadLabel,
  type UpNext,
  weekTile,
  workoutMeta,
  zooHref,
} from '@/lib/today-logic';
import { fetchAward } from '@/lib/awards';
import { newBestCount } from '@/lib/awards-logic';
import { goalCountdown } from '@/lib/coach-tab';
import { fetchLog } from '@/lib/log-api';
import { useActiveLog } from '@/lib/use-active-log';
import { useCachedLoad } from '@/lib/use-cached-load';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useCommunity } from '@/lib/use-community';
import { useFood } from '@/lib/use-food';
import { useMessages } from '@/lib/use-messages';
import { useProgressFacts } from '@/lib/use-progress-facts';
import type { WorkoutSummary } from '@/lib/workouts';
import { planTotals } from '@/lib/workouts-plan';
import { palette, pressedOpacity, radius, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';
import { Overline, useStacked } from './parts';

/** The hero cards' corner (a little rounder than the other cards, as on the boards). */
export const HERO_RADIUS = 22;
const HERO_SHADOW = 4;
const STICKER = 48;
/** Between the lines of the small tiles (6 pt, as on the boards). */
const TILE_GAP = 6;


/** The coach chat: the Coach tab's first screen. */
export const COACH_CHAT_HREF = '/coach';
/** The add-meal sheet. */
const ADD_MEAL_HREF = '/food/add';

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

/** A workout in progress on this phone: "6 of 19 sets · next: A1 Romanian Deadlift" and how far along it is. */
export type WorkoutProgress = { done: number; total: SetRange; next: string | null };

export function WorkoutCard({
  workout,
  doc,
  status,
  progress,
  starting,
  onStart,
  onView,
  upNext = null,
}: {
  workout: WorkoutSummary;
  /** The whole plan, once read (for the sets and time); null meanwhile. */
  doc: WorkoutDoc | null;
  status: WorkoutStatus | null;
  /** In progress on this phone: its ticked sets and what is next. */
  progress: WorkoutProgress | null;
  starting: boolean;
  /** Start (straight to the first set) or Continue. */
  onStart: () => void;
  /** Opens the finished workout's summary. */
  onView: (logId: string) => void;
  /** Once all of today's workouts are done: the next planned one, shown inside this done card. */
  upNext?: UpNext | null;
}) {
  const { text, space } = useTheme();
  const router = useRouter();
  const stacked = useStacked();
  const totals = doc ? planTotals(doc) : null;
  const meta = workoutMeta(totals?.exercises ?? workout.exerciseCount, totals);
  const chip = programChip(workout.programDay ?? null);

  // Done: the card shrinks to one row (approved Today states board) and the food card moves up under it.
  if (status?.kind === 'done') {
    return <DoneRow workout={workout} logId={status.logId} durationS={status.durationS} onView={onView} upNext={upNext} />;
  }

  const going = status?.kind === 'in_progress';
  const fraction = progress ? progress.done / Math.max(1, progress.total.max) : 0;
  return (
    <Hero tone="lime" testID={`today-workout-${workout.id}`}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Overline>{going ? 'Today’s workout · In progress' : 'Today’s workout'}</Overline>
        </View>
        {chip && !going ? (
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
      {going && progress ? (
        <>
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: progress.total.max, now: progress.done }}
            accessibilityLabel="Sets ticked"
          >
            <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, fraction) * 100)}%` }]} />
          </View>
          <Text style={[text('body'), styles.meta, styles.bold]} testID={`today-progress-${workout.id}`}>
            {[setProgressText(progress.done, progress.total), progress.next ? `next: ${progress.next}` : null].filter(Boolean).join(' · ')}
          </Text>
        </>
      ) : (
        <Text style={[text('body'), styles.meta]} testID={`today-meta-${workout.id}`}>
          {meta}
        </Text>
      )}
      <View style={[stacked || going ? styles.column : styles.row, { gap: space[2.5], marginTop: space[1] }, !stacked && !going && styles.top]}>
        <View style={stacked || going ? undefined : styles.flex}>
          <Button
            title={going ? 'Continue' : 'Start workout'}
            testID={`start-${workout.id}`}
            ph-label="log_start_workout"
            onPress={onStart}
            busy={starting}
          />
        </View>
        {going ? null : (
          <Button variant="secondary" title="Preview" testID={`view-workout-${workout.id}`} onPress={() => router.push(previewHref(workout.id))} />
        )}
      </View>
    </Hero>
  );
}

/** "Lower Body done · 17 of 19 sets · 2 new bests · Summary ›": the finished workout, one tap from its summary. */
function DoneRow({
  workout,
  logId,
  durationS,
  onView,
  upNext,
}: {
  workout: WorkoutSummary;
  logId: string;
  durationS: number;
  onView: (logId: string) => void;
  upNext: UpNext | null;
}) {
  const { text, space } = useTheme();
  const { finishedLog, pending } = useActiveLog();
  const local = finishedLog?.id === logId ? finishedLog : (pending.find((p) => p.id === logId) ?? null);
  const [remote, setRemote] = useState<WorkoutLogDoc | null>(null);
  const [bests, setBests] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!local) void fetchLog(logId).then((l) => alive && setRemote(l), () => undefined);
    void fetchAward(logId).then((a) => alive && setBests(a ? newBestCount(a) : null));
    return () => {
      alive = false;
    };
  }, [logId, local]);
  const log = local ?? remote;
  const counts = log ? logSetCount(log) : null;
  const line = doneLine(counts ? setProgressText(counts.done, { min: counts.total.min, max: counts.total.min }) : null, bests, formatLogDuration(durationS));
  const summary = (
    <Pressable
      testID={`today-done-${workout.id}`}
      onPress={() => onView(logId)}
      accessibilityRole="button"
      accessibilityLabel={`${workout.name} done. ${line}`}
      accessibilityHint="Opens the workout summary"
      style={({ pressed }) => [
        styles.row,
        { padding: space[3.5], gap: space[3], minHeight: 64 },
        !upNext && [styles.quiet, styles.doneCard],
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.doneTick}>
        <Text style={[text('sectionHeading'), styles.onInk]}>✓</Text>
      </View>
      <View style={styles.flex}>
        <Text testID={`done-${workout.id}`} style={text('sectionHeading')} numberOfLines={2}>{`${workout.name} done`}</Text>
        <Text style={[text('body'), styles.ink]}>{line}</Text>
      </View>
      <Text testID={`view-log-${workout.id}`} style={text('sectionHeading')}>
        Summary ›
      </Text>
    </Pressable>
  );
  if (!upNext) return summary;
  // All done today: the next planned workout sits inside the same card, under a hairline (approved Up next board).
  return (
    <View style={[styles.quiet, styles.doneCard, styles.clip]}>
      {summary}
      <UpNextRow upNext={upNext} />
    </View>
  );
}

/** "UP NEXT · SATURDAY / Lower · Preview ›": the whole row opens the workout's preview (no Start: it's another day). */
function UpNextRow({ upNext }: { upNext: UpNext }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const stacked = useStacked();
  return (
    <Pressable
      testID="today-up-next"
      onPress={() => router.push(previewHref(upNext.id))}
      accessibilityRole="button"
      accessibilityLabel={upNext.accessibilityLabel}
      style={({ pressed }) => [
        stacked ? styles.upNextStacked : styles.row,
        styles.hairline,
        { paddingHorizontal: space[3.5], paddingVertical: space[3], gap: stacked ? space[1] : space[2.5], minHeight: tapTarget.min },
        pressed && styles.pressed,
      ]}
    >
      <View style={stacked ? undefined : styles.flex}>
        <Text style={styles.upNextLabel}>{upNext.label}</Text>
        <Text testID="today-up-next-name" style={[text('body'), styles.bold, styles.ink]}>
          {upNext.name}
        </Text>
      </View>
      <Text style={text('sectionHeading')}>Preview ›</Text>
    </Pressable>
  );
}

// ---- Rest day ----------------------------------------------------------------------------------------------

export function RestCard({
  next,
  today,
  coachName,
  onLogAnyway,
}: {
  next: WorkoutSummary | null;
  today: string;
  /** For "Luis is building your plan" when nothing is planned ahead. */
  coachName: string | null;
  onLogAnyway: () => void;
}) {
  const { text, space } = useTheme();
  const router = useRouter();
  const first = coachName?.trim().split(/\s+/)[0] || 'Your coach';
  return (
    <View testID="today-rest" style={[styles.restCard, { borderRadius: 18, padding: space[3.5], gap: space[1] }]}>
      <Text style={[text('sectionHeading'), styles.restTitle]} accessibilityRole="header">
        {next ? 'Rest day' : `${first} is building your plan`}
      </Text>
      <Text testID={next ? 'today-next' : 'today-no-plan'} style={[text('body'), styles.ink]}>
        {next ? restNextLine(next.name, next.scheduledOn, today) : 'Next workout coming soon'}
      </Text>
      <View style={[styles.row, styles.wrap, { gap: space[2], marginTop: space[2] }]}>
        {next ? (
          <Pressable
            testID="today-next-preview"
            onPress={() => router.push(previewHref(next.id))}
            accessibilityRole="button"
            accessibilityLabel={`Preview ${next.name}`}
            style={({ pressed }) => [styles.smallButton, { paddingHorizontal: space[3.5] }, pressed && styles.pressed]}
          >
            <Text style={text('sectionHeading')}>{restPreviewLabel(next.scheduledOn, today)}</Text>
          </Pressable>
        ) : null}
        <TextButton title="Log a workout anyway" testID="today-log-anyway" onPress={onLogAnyway} />
      </View>
    </View>
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
  const line = useMemo(() => (meals ? foodLine(meals, food?.targets ?? null) : null), [meals, food?.targets]);
  const stacked = useStacked();
  if (!line) return null;

  return (
    <View testID="today-food" style={[styles.quiet, { borderRadius: 18, paddingHorizontal: space[4], paddingVertical: space[3.5], gap: 6 }]}>
      {/* Large text: the title and + Add meal stack, so neither is squeezed. */}
      <View style={[stacked ? styles.foodStack : styles.row, { gap: space[2] }]}>
        <Text style={[text('sectionHeading'), styles.cardTitle, !stacked && styles.flex]} accessibilityRole="header">
          Food today
        </Text>
        <Pressable
          testID="today-add-meal"
          ph-label="log_add_meal"
          onPress={() => router.push(ADD_MEAL_HREF)}
          accessibilityRole="button"
          accessibilityLabel="Add meal"
          style={({ pressed }) => [styles.addMeal, { paddingHorizontal: space[4] }, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>+ Add meal</Text>
        </Pressable>
      </View>
      <Text testID="today-food-line" style={[text('body'), styles.ink]} accessibilityLabel={line.label}>
        {line.parts.map((p, i) => (
          <Text key={i}>
            {i > 0 ? ' · ' : ''}
            <Text style={styles.heavy}>{p.strong}</Text>
            {p.rest}
          </Text>
        ))}
      </Text>
    </View>
  );
}

// ---- The coach's goal --------------------------------------------------------------------------------------

/** "GOAL  Run a 5K under 30 min  49 days": the goal the coach set, one tap from the Coach tab. Hidden without one. */
export function GoalStrip() {
  const { text, space } = useTheme();
  const router = useRouter();
  const coach = useCoachProfile();
  const goal = coach?.goal ?? null;
  if (!goal) return null;
  const days = goalStripDays(goalCountdown(goal.targetDate, localToday()));
  return (
    <Pressable
      testID="today-goal"
      onPress={() => router.navigate(COACH_CHAT_HREF)}
      accessibilityRole="button"
      accessibilityLabel={`Goal: ${goal.goal}${days ? `, ${days}` : ''}`}
      accessibilityHint="Opens the Coach tab"
      style={({ pressed }) => [styles.row, styles.quiet, { borderRadius: 16, paddingHorizontal: space[3.5], paddingVertical: space[3], gap: space[2.5], minHeight: 52 }, pressed && styles.pressed]}
    >
      <Text style={[text('caption'), styles.goalLabel]}>GOAL</Text>
      <Text style={[text('body'), styles.bold, styles.flex]} numberOfLines={2}>
        {goal.goal}
      </Text>
      {days ? <Text style={[text('caption'), styles.goalDays]}>{days}</Text> : null}
    </Pressable>
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
  // The app's one source for these numbers (useProgressFacts), so Today, Progress and the Zoo book always agree. While
  // the latest workout is still syncing or being awarded it says "Updating…" instead of numbers that are about to change.
  const { facts, hub, album } = useProgressFacts(refreshKey);
  const updating = facts.updating;
  const tile = useMemo(() => (facts.week ? weekTile(facts.week) : null), [facts.week]);
  const newest = facts.stickers?.newest ?? null;
  const zooLabel = facts.stickers ? `Zoo ${facts.stickers.count} of ${STICKERS.length}` : '';
  const half: StyleProp<ViewStyle> = stacked ? undefined : styles.flex;

  return (
    <View style={[stacked ? styles.column : styles.row, styles.stretch, { gap: space[2.5] }]}>
      <Pressable
        testID="today-week"
        onPress={() => router.navigate('/progress')}
        accessibilityRole="button"
        accessibilityLabel={updating ? 'This week: updating' : tile ? `This week: ${tile.big} ${tile.small}` : 'This week'}
        accessibilityHint="Opens Progress"
        style={({ pressed }) => [styles.tile, styles.weekTile, { padding: space[3.5], gap: TILE_GAP }, half, pressed && styles.pressed]}
      >
        <Overline>This week</Overline>
        {updating ? (
          <Text style={[text('sectionHeading'), styles.ink]} testID="today-week-updating">
            Updating…
          </Text>
        ) : tile ? (
          <>
            <Text style={[text('bigNumber'), styles.weekBig]} maxFontSizeMultiplier={1.4}>
              {tile.big}
            </Text>
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
        accessibilityLabel={updating ? 'Newest sticker: updating' : newest ? `Newest sticker: ${newest.name}${newest.shiny ? ', shiny' : ''}. ${zooLabel}` : 'Newest sticker: none yet'}
        accessibilityHint="Opens your zoo book"
        style={({ pressed }) => [styles.tile, { padding: space[3.5], gap: TILE_GAP }, half, pressed && styles.pressed]}
      >
        <Overline>Newest sticker</Overline>
        {updating ? (
          <Text style={[text('sectionHeading'), styles.ink]} testID="today-sticker-updating">
            Updating…
          </Text>
        ) : newest ? (
          <View style={[styles.row, { gap: space[2] }]}>
            <View style={[styles.stickerBox, styles.tilt]}>
              <Sticker stickerKey={newest.key} size={STICKER - 8} shiny={newest.shiny} variant="sm" />
            </View>
            <Text style={[text('sectionHeading'), styles.flex]} numberOfLines={2} testID="today-sticker-name">
              {newest.name}
            </Text>
          </View>
        ) : facts.stickers ? (
          <Text style={[text('caption'), styles.ink]}>None yet</Text>
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
  const { community, ready, removed, coaches, blocked, unread, reported } = useCommunity();
  const communityId = community?.id ?? null;
  const posts = useCachedLoad(
    me && communityId ? `${me}:${communityId}` : null,
    () => (me && communityId ? readCachedPosts(me, communityId) : Promise.resolve(null)),
    () => (me && communityId ? fetchLatestPosts(me, communityId, blocked) : Promise.resolve([])),
    refreshKey,
  );
  const headline = useMemo(() => {
    const newest = posts.data?.find((p) => !blocked.has(p.authorId) && !reported.has(p.id));
    if (!posts.data || !me) return null;
    return newest ? communityHeadline(postPreview(newest, { me, coaches, units })) : 'No posts yet. Say hello!';
  }, [posts.data, me, blocked, reported, coaches, units]);

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
      {badge ? <CountBadge label={badge} /> : null}
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
  restTitle: { fontSize: 18 },
  restCard: { backgroundColor: palette.surface },
  foodStack: { flexDirection: 'column', alignItems: 'flex-start' },
  wrap: { flexWrap: 'wrap' },
  bold: { fontFamily: fontFamilyFor('sans', 700) },
  heavy: { fontFamily: fontFamilyFor('sans', 800) },
  onInk: { color: white },
  doneTick: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.bg,
    borderWidth: borderWidth.secondaryButton,
    borderColor: palette.ink,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: { height: '100%', backgroundColor: palette.ink },
  goalLabel: { color: palette.inkMuted, fontFamily: fontFamilyFor('sans', 800), letterSpacing: 0.4 },
  goalDays: { color: palette.inkMuted, fontFamily: fontFamilyFor('sans', 700) },
  meta: { color: palette.ink },
  chip: { backgroundColor: palette.bg, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink, borderRadius: radius.pill },
  chipText: { color: palette.ink, fontSize: 12 },
  nextBox: { backgroundColor: palette.bg, borderWidth: borderWidth.card, borderColor: palette.ink, borderRadius: 16 },
  nextDay: { color: palette.inkMuted },
  nextName: { fontSize: 17 },
  outlined: { borderWidth: borderWidth.card, borderColor: palette.ink },
  quiet: { borderWidth: borderWidth.card, borderColor: palette.border },
  doneCard: { borderRadius: 18 },
  clip: { overflow: 'hidden' },
  hairline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  upNextStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  upNextLabel: {
    fontFamily: fontFamilyFor('sans', 800),
    fontSize: typeScale.caption.size.phone,
    letterSpacing: typeScale.caption.size.phone * 0.04,
    textTransform: 'uppercase',
    color: palette.inkMuted,
  },
  cardTitle: { fontSize: 18 },
  addMeal: {
    minHeight: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.lime,
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
});
