import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { badgeLabel, dayLabel, thumbPathOf } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { Bubble } from '@/components/messages/bubble';
import { Composer } from '@/components/messages/composer';
import { useSignedUrls } from '@/components/messages/use-signed-urls';
import { Button } from '@/components/ui';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useCommunity } from '@/lib/use-community';
import { useMessages, type ThreadItem } from '@/lib/use-messages';
import { palette, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type Row = { kind: 'day'; key: string; label: string } | { kind: 'message'; key: string; item: ThreadItem };

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export default function CoachTab() {
  const { text } = useTheme();
  // Null while loading, when there is no coach link, or on first launch offline: the header then says "Your coach".
  const coach = useCoachProfile();
  const coachName = coach?.name.trim() || null;
  const chat = useMessages();
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const timeZone = useMemo(zone, []);

  const setViewing = chat?.setViewing;
  // Messages are marked read only while this tab is on screen.
  useFocusEffect(
    useCallback(() => {
      setViewing?.(true);
      return () => setViewing?.(false);
    }, [setViewing]),
  );

  const items = chat?.items;
  const paths = useMemo(() => {
    const out = new Set<string>();
    for (const i of items ?? []) if (!('state' in i)) for (const p of i.imagePaths) out.add(p).add(thumbPathOf(p));
    return [...out];
  }, [items]);
  const urls = useSignedUrls(paths);

  // Newest first, because the list is inverted (it opens at the latest message and the keyboard pushes it up).
  const rows = useMemo<Row[]>(() => {
    const now = new Date().toISOString();
    const out: Row[] = [];
    let last = '';
    for (const item of items ?? []) {
      const label = dayLabel(item.createdAt, now, timeZone);
      if (label !== last) {
        out.push({ kind: 'day', key: `day-${item.createdAt}`, label });
        last = label;
      }
      out.push({ kind: 'message', key: item.clientMsgId, item });
    }
    return out.reverse();
  }, [items, timeZone]);

  // The community lives behind the Coach tab (the tab bar stays at five): a button with its unread count.
  const router = useRouter();
  const community = useCommunity();
  const communityBadge = badgeLabel(community.unread);
  const header = (
    <View style={styles.header} accessibilityRole="header">
      <CoachAvatar name={coachName ?? 'Coach'} url={coach?.avatarUrl ?? null} size={44} />
      <View style={styles.headerText}>
        <Text style={text('sectionHeading')} testID="coach-name" numberOfLines={1}>{coachName ?? 'Your coach'}</Text>
        {coach?.businessName ? <Text style={text('caption')} numberOfLines={1}>{coach.businessName}</Text> : null}
      </View>
      {community.community ? (
        <Pressable
          testID="open-community"
          accessibilityRole="button"
          accessibilityLabel={communityBadge ? `Community, ${communityBadge} new` : 'Community'}
          onPress={() => router.push('/community')}
          style={({ pressed }) => [styles.communityButton, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>Community</Text>
          {communityBadge ? (
            <View style={styles.communityBadge}>
              <Text style={[text('caption'), styles.communityBadgeText]}>{communityBadge}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
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
                <Text style={text('body')}>No messages yet. Say hello to {coachName?.split(' ')[0] ?? 'your coach'}.</Text>
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
                <Text style={[text('caption'), styles.day]}>{r.label}</Text>
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
        {unavailable ? null : <Composer onSend={chat.send} />}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: palette.border },
  headerText: { flex: 1, gap: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  flip: { transform: [{ scaleY: -1 }] },
  list: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3] },
  day: { alignSelf: 'center', paddingVertical: space[2] },
  more: { alignSelf: 'center', padding: space[3] },
  banner: { padding: space[3], gap: space[2], backgroundColor: palette.celebrateBg },
  viewer: { flex: 1, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  communityButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: palette.ink,
  },
  pressed: { opacity: 0.75 },
  communityBadge: { minWidth: 20, paddingHorizontal: space[1], borderRadius: radius.pill, alignItems: 'center', backgroundColor: palette.magenta },
  communityBadgeText: { color: white },
});
