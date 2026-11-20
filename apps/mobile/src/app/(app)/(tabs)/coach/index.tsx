import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderWidth } from '@caltracker/design-tokens';
import { thumbPathOf } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { BackIcon } from '@/components/community/icons';
import { Bubble } from '@/components/messages/bubble';
import { CommentCard } from '@/components/messages/comment-card';
import { Composer } from '@/components/messages/composer';
import { useSignedUrls } from '@/components/messages/use-signed-urls';
import { Button } from '@/components/ui';
import { QUICK_REPLIES, buildChatRows, coachFirstName, type WorkoutComment } from '@/lib/coach-tab';
import { fetchMyWorkoutComments } from '@/lib/log-api';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useMessages } from '@/lib/use-messages';
import { palette, pressedOpacity, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * The chat with the coach, opened from the Coach profile's Message button (or a tapped message push). Realtime
 * messages, the offline outbox, photos, earlier messages and "Seen" come from use-messages; the coach's comments on
 * the client's workouts show inline as small cards.
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

  const setViewing = chat?.setViewing;
  // Messages are marked read only while the chat is on screen. Workout comments are fetched again each time it opens
  // (a failed read keeps what was shown: they are a bonus to the chat).
  useFocusEffect(
    useCallback(() => {
      setViewing?.(true);
      let alive = true;
      fetchMyWorkoutComments()
        .then((c) => alive && setComments(c))
        .catch(() => undefined);
      return () => {
        alive = false;
        setViewing?.(false);
      };
    }, [setViewing]),
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

  const back = () => (router.canGoBack() ? router.back() : router.replace('/coach'));
  const header = (
    <View style={styles.header}>
      <Pressable
        testID="coach-chat-back"
        accessibilityRole="button"
        accessibilityLabel={first ? `Back to ${first}’s profile` : 'Back to your coach’s profile'}
        onPress={back}
        style={({ pressed }) => [styles.back, pressed && { opacity: pressedOpacity }]}
      >
        <BackIcon />
      </Pressable>
      <CoachAvatar name={coachName ?? 'Coach'} url={coach?.avatarUrl ?? null} size={40} ring={2} />
      <View style={styles.headerText} accessibilityRole="header">
        <Text style={[text('sectionHeading'), styles.headerName]} testID="coach-chat-name" numberOfLines={1}>{coachName ?? 'Your coach'}</Text>
        {coachName ? <Text style={[text('body'), styles.headerSub]}>Your coach</Text> : null}
      </View>
    </View>
  );

  if (!chat || chat.status === 'loading') {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        {header}
        <View style={styles.center}><ActivityIndicator color={palette.ink} accessibilityLabel="Loading messages" /></View>
      </SafeAreaView>
    );
  }

  const unavailable = chat.conversationId === null;
  const empty = rows.length === 0;

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
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
          <Composer onSend={chat.send} placeholder={first ? `Message ${first}` : 'Write a message'} quickReplies={QUICK_REPLIES} />
        )}
      </KeyboardAvoidingView>
      <Modal visible={openPhoto !== null} transparent animationType="fade" onRequestClose={() => setOpenPhoto(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpenPhoto(null)} accessibilityRole="button" accessibilityLabel="Close photo">
          {openPhoto ? <Image source={{ uri: openPhoto }} style={styles.viewerImage} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2.5],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
    borderBottomWidth: borderWidth.card,
    borderBottomColor: palette.border,
  },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  headerText: { flex: 1 },
  headerName: { fontSize: 18 },
  headerSub: { fontSize: 13, color: palette.inkMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  flip: { transform: [{ scaleY: -1 }] },
  list: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2] },
  day: { alignSelf: 'center', paddingVertical: space[1], fontSize: 12, color: palette.inkMuted },
  more: { alignSelf: 'center', padding: space[3] },
  banner: { padding: space[3], gap: space[2], backgroundColor: palette.celebrateBg },
  viewer: { flex: 1, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
});
