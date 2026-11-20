import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { localToday, thumbPathOf } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { Bubble } from '@/components/messages/bubble';
import { CommentCard } from '@/components/messages/comment-card';
import { Composer } from '@/components/messages/composer';
import { useSignedUrls } from '@/components/messages/use-signed-urls';
import { Button } from '@/components/ui';
import { QUICK_REPLIES, buildChatRows, coachFirstName, coachStrip, showQuickReplies, type StripCell, type WorkoutComment } from '@/lib/coach-tab';
import { fetchMyWorkoutComments } from '@/lib/log-api';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useCommunity } from '@/lib/use-community';
import { useFood } from '@/lib/use-food';
import { useMessages } from '@/lib/use-messages';
import { palette, pressedOpacity, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * The Coach tab: straight into the chat with the coach (a tapped message push lands here too). A compact header
 * (photo, name, "Your coach"; tap for their profile) and a strip with the goal, the coach's meals and the community
 * sit on top. Realtime messages, the offline outbox, photos, earlier messages and "Seen" come from use-messages; the
 * coach's comments on the client's workouts show inline as small cards.
 */
export default function CoachChat() {
  const { text } = useTheme();
  const router = useRouter();
  // Null while loading, when there is no coach link, or on first launch offline: the header then says "Your coach".
  const coach = useCoachProfile();
  const coachName = coach?.name.trim() || null;
  const first = coachFirstName(coachName);
  const chat = useMessages();
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [comments, setComments] = useState<WorkoutComment[]>([]);
  const timeZone = useMemo(zone, []);
  const food = useFood();
  const community = useCommunity();
  const loadCoachMeals = food?.loadCoachMeals;

  const setViewing = chat?.setViewing;
  // Messages are marked read only while the chat is on screen. Workout comments are fetched again each time it opens
  // (a failed read keeps what was shown: they are a bonus to the chat).
  useFocusEffect(
    useCallback(() => {
      setViewing?.(true);
      // The coach's meals for the strip: the saved list shows at once, a fresh one loads each visit.
      void loadCoachMeals?.();
      let alive = true;
      fetchMyWorkoutComments()
        .then((c) => alive && setComments(c))
        .catch(() => undefined);
      return () => {
        alive = false;
        setViewing?.(false);
      };
    }, [setViewing, loadCoachMeals]),
  );

  const items = chat?.items;
  const paths = useMemo(() => {
    const out = new Set<string>();
    for (const i of items ?? []) if (!('state' in i)) for (const p of i.imagePaths) out.add(p).add(thumbPathOf(p));
    return [...out];
  }, [items]);
  const urls = useSignedUrls(paths);

  const hasMore = chat?.hasMore ?? false;
  const rows = useMemo(
    () => buildChatRows({ items: items ?? [], comments, hasMore, now: new Date().toISOString(), timeZone }),
    [items, comments, hasMore, timeZone],
  );

  const cells = coachStrip({
    goal: coach?.goal ?? null,
    today: localToday(timeZone),
    mealCount: food?.coachMeals.length ?? 0,
    firstName: first,
    hasCommunity: community.community !== null,
    communityUnread: community.unread,
  });
  const openCell = (key: StripCell['key']) => router.push(key === 'goal' ? '/coach/about' : key === 'meals' ? '/coach-meals' : '/community');
  const header = (
    <View>
      <Pressable
        testID="coach-header"
        accessibilityRole="button"
        accessibilityLabel={`${coachName ?? 'Your coach'}, your coach. About`}
        onPress={() => router.push('/coach/about')}
        style={({ pressed }) => [styles.header, pressed && { opacity: pressedOpacity }]}
      >
        <CoachAvatar name={coachName ?? 'Coach'} url={coach?.avatarUrl ?? null} size={44} ring={2} />
        <View style={styles.headerText}>
          <Text style={[text('sectionHeading'), styles.headerName]} testID="coach-name" numberOfLines={1}>{coachName ?? 'Your coach'}</Text>
          {coachName ? <Text style={[text('body'), styles.headerSub]}>Your coach</Text> : null}
        </View>
      </Pressable>
      <View style={styles.strip} testID="coach-strip">
        {cells.map((c, i) => (
          <Pressable
            key={c.key}
            testID={`coach-strip-${c.key}`}
            accessibilityRole="button"
            accessibilityLabel={c.accessibilityLabel}
            onPress={() => openCell(c.key)}
            style={({ pressed }) => [styles.cell, i < cells.length - 1 && styles.cellDivider, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('caption'), styles.cellLabel]} numberOfLines={1}>{c.label}</Text>
            <Text style={[text('sectionHeading'), styles.cellValue]} numberOfLines={c.detail ? 1 : 2}>{c.value}</Text>
            {c.detail ? <Text style={[text('sectionHeading'), styles.cellValue]} numberOfLines={1}>{c.detail}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );

  if (!chat || chat.status === 'loading') {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      <View style={styles.column}>
        {header}
        <View style={styles.center}><ActivityIndicator color={palette.ink} accessibilityLabel="Loading messages" /></View>
      </View>
    </SafeAreaView>
    );
  }

  const unavailable = chat.conversationId === null;
  const empty = rows.length === 0;

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      <View style={styles.column}>
      {header}
      {chat.status === 'offline' ? (
        <View style={styles.banner}>
          <Text style={text('caption')} testID="coach-offline">Couldn’t reach the server. Messages you write will send when you’re back online.</Text>
          <Button title="Try again" variant="secondary" onPress={chat.reload} />
        </View>
      ) : null}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {unavailable ? (
          <View style={styles.center}><Text style={text('body')}>Your conversation isn’t available right now.</Text></View>
        ) : (
          <FlatList
            testID="coach-thread"
            style={styles.fill}
            contentContainerStyle={styles.list}
            data={rows}
            inverted
            keyboardShouldPersistTaps="handled"
            keyExtractor={(r) => r.key}
            ListEmptyComponent={
              // An inverted list flips its empty state too, so it is flipped back.
              <View style={[styles.center, styles.flip]}>
                <Text style={text('body')}>No messages yet. Say hello to {first ?? 'your coach'}.</Text>
              </View>
            }
            ListFooterComponent={
              chat.hasMore && !empty ? (
                <Pressable accessibilityRole="button" onPress={() => void chat.loadEarlier().catch(() => undefined)} style={styles.more}>
                  <Text style={text('caption')}>Show earlier messages</Text>
                </Pressable>
              ) : undefined
            }
            renderItem={({ item: r }) =>
              r.kind === 'day' ? (
                <Text style={[text('sectionHeading'), styles.day]}>{r.label}</Text>
              ) : r.kind === 'comment' ? (
                <CommentCard title={r.title} body={r.comment.body} onPress={() => router.push(`/log/${r.comment.logId}/summary`)} />
              ) : (
                <Bubble
                  item={r.item}
                  mine={'id' in r.item ? r.item.senderId === chat.me : true}
                  seen={'id' in r.item && r.item.id === chat.seenId}
                  timeZone={timeZone}
                  urls={urls}
                  error={chat.failedError[r.item.clientMsgId]}
                  onRetry={chat.retry}
                  onDelete={chat.remove}
                  onOpenPhoto={setOpenPhoto}
                />
              )
            }
          />
        )}
        {unavailable ? null : (
          <Composer
            onSend={chat.send}
            placeholder={first ? `Message ${first}` : 'Message your coach'}
            quickReplies={showQuickReplies(items ?? [], chat.me) ? QUICK_REPLIES : []}
          />
        )}
      </KeyboardAvoidingView>
      <Modal visible={openPhoto !== null} transparent animationType="fade" onRequestClose={() => setOpenPhoto(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpenPhoto(null)} accessibilityRole="button" accessibilityLabel="Close photo">
          {openPhoto ? <Image source={{ uri: openPhoto }} style={styles.viewerImage} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
        </Pressable>
      </Modal>
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  // On iPad and wider, the chat keeps a readable centred column (UI rules: chat at most ~760).
  column: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2] },
  headerText: { flex: 1 },
  headerName: { fontSize: 20 },
  headerSub: { fontSize: 13, color: palette.inkMuted },
  // Three equal cells between hairlines, each at least 56 pt tall.
  strip: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.border },
  cell: { flex: 1, minHeight: 56, justifyContent: 'center', paddingHorizontal: space[3], paddingVertical: space[1] },
  cellDivider: { borderRightWidth: 1, borderRightColor: palette.border },
  cellLabel: { fontSize: 12, color: palette.inkMuted, letterSpacing: 0.4 },
  cellValue: { fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  flip: { transform: [{ scaleY: -1 }] },
  list: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2] },
  day: { alignSelf: 'center', paddingVertical: space[1], fontSize: 12, color: palette.inkMuted },
  more: { alignSelf: 'center', padding: space[3] },
  banner: { padding: space[3], gap: space[2], backgroundColor: palette.celebrateBg },
  viewer: { flex: 1, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
});
