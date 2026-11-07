import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { badgeLabel, sortFeed, withoutBlocked } from '@caltracker/shared';
import { PostItem, type PostContext } from '@/components/community/post-item';
import { usePostMedia } from '@/components/community/use-post-media';
import { Button, Card, ErrorText, Screen, TextButton } from '@/components/ui';
import { loadFeed, type FeedPost } from '@/lib/community-api';
import { useLive } from '@/lib/community-live';
import { useCommunity } from '@/lib/use-community';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * The community feed, opened from the Coach tab: pinned posts first, then newest. New posts, comments and likes arrive
 * live.
 */
export default function CommunityScreen() {
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const units = useUnits() ?? 'lb';
  const { community, ready, removed, offline, coaches, blocked, setBlocked, unread, refresh } = useCommunity();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!community) return;
    try {
      setPosts(await loadFeed(community.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the community.');
    }
    setNow(Date.now());
  }, [community]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void load();
    }, [refresh, load]),
  );

  useLive(
    community
      ? [
          // Deletes arrive as an update of the community row.
          { table: 'communities', filter: `id=eq.${community.id}` },
          { table: 'community_posts', filter: `community_id=eq.${community.id}` },
          { table: 'community_comments', filter: `community_id=eq.${community.id}` },
          { table: 'community_likes', filter: `community_id=eq.${community.id}` },
        ]
      : [],
    () => void load(),
  );

  const visible = useMemo(() => sortFeed(withoutBlocked(posts ?? [], blocked)), [posts, blocked]);
  const media = usePostMedia(visible);
  const ctx: PostContext | null = community
    ? {
        me,
        workspaceId: community.workspaceId,
        coaches,
        units,
        now,
        onChanged: () => void load(),
        onBlocked: (id) => setBlocked(new Set([...blocked, id])),
      }
    : null;

  const badge = badgeLabel(unread);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void Promise.all([refresh(), load()]).finally(() => setRefreshing(false));
      }}
    >
      <View style={styles.header}>
        <TextButton title="Back" testID="community-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/coach'))} />
      </View>
      <View style={[styles.header, { gap: space[3] }]}>
        <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
          Community
        </Text>
        {community ? (
          <Pressable
            testID="community-notifications"
            accessibilityRole="button"
            accessibilityLabel={badge ? `Notifications, ${badge} new` : 'Notifications'}
            onPress={() => router.push('/community/notifications')}
            style={({ pressed }) => [styles.bell, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('screenTitle')}>🔔</Text>
            {badge ? (
              <View style={[styles.badge, { borderRadius: radius.pill, paddingHorizontal: space[1] }]}>
                <Text style={[text('caption'), styles.badgeText]}>{badge}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {!ready ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {ready && removed ? (
        <Card>
          <Text style={text('sectionHeading')} testID="community-removed">
            You’re not in the community right now.
          </Text>
          <Text style={text('body')}>Your coach has taken you out of the group. You can still train and message your coach as usual.</Text>
        </Card>
      ) : null}
      {ready && !community && offline ? <Text style={text('caption')}>You’re offline. The community shows when you’re back online.</Text> : null}

      {community && ctx ? (
        <>
          <Text style={text('caption')}>Only you, your coach and their clients can see this. Members see your name and photo.</Text>
          <Button title="New post" testID="community-new-post" onPress={() => router.push('/community/new')} />
          {error ? <ErrorText>{error}</ErrorText> : null}
          {posts === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading posts" /> : null}
          {posts !== null && visible.length === 0 ? (
            <Text style={text('body')} testID="community-empty">
              No posts yet. Say hello!
            </Text>
          ) : null}
          {visible.map((p) => (
            <PostItem
              key={p.id}
              post={p}
              ctx={ctx}
              avatarUrl={media.avatarUrl(p)}
              thumbUrls={media.thumbs}
              fullUrls={media.fullUrl}
              onOpenComments={() => router.push({ pathname: '/community/[id]', params: { id: p.id } })}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  bell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 0, right: 0, minWidth: 20, alignItems: 'center', backgroundColor: palette.magenta },
  badgeText: { color: white },
});
