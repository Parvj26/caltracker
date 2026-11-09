import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { badgeLabel, coachFilterLabel, communitySubtitle, filterFeed, sortFeed, withoutBlocked, type FeedFilter } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { BackIcon, BellIcon, PhotoIcon } from '@/components/community/icons';
import { PostItem, type PostContext } from '@/components/community/post-item';
import { usePostMedia } from '@/components/community/use-post-media';
import { Card, ErrorText, Screen } from '@/components/ui';
import { loadFeed, memberCount, myProfile, namesOf, type FeedPost } from '@/lib/community-api';
import { useLive } from '@/lib/community-live';
import { useCommunity } from '@/lib/use-community';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';

/**
 * The community feed, opened from the Coach tab: a box to share, filters (all, the coach's posts, wins), pinned posts
 * first, then newest, each with its newest comments. New posts, comments and reactions arrive live.
 */
export default function CommunityScreen() {
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { session, workspace } = useSession();
  const me = session?.user.id ?? '';
  const units = useUnits() ?? 'lb';
  const { community, ready, removed, offline, coaches, blocked, setBlocked, unread, refresh } = useCommunity();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [members, setMembers] = useState<number | null>(null);
  const [profile, setProfile] = useState<{ name: string; avatarPath: string | null } | null>(null);
  const [coachNames, setCoachNames] = useState<Record<string, string>>({});

  // The member count and my photo are extras (the feed shows without them), fetched on arrival and pull to refresh
  // only, not on every live change.
  const loadExtras = useCallback(() => {
    if (!community) return;
    void memberCount(community.id).then((n) => n !== null && setMembers(n));
    void myProfile()
      .then((p) => p && setProfile(p))
      .catch(() => undefined);
  }, [community]);

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

  const coachKey = [...coaches].sort().join(',');
  useEffect(() => {
    const ids = coachKey ? coachKey.split(',') : [];
    let alive = true;
    void namesOf(ids)
      .then((n) => alive && setCoachNames(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [coachKey]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void load();
      loadExtras();
    }, [refresh, load, loadExtras]),
  );

  useLive(
    community
      ? [
          // Deletes arrive as an update of the community row.
          { table: 'communities', filter: `id=eq.${community.id}` },
          { table: 'community_posts', filter: `community_id=eq.${community.id}` },
          { table: 'community_comments', filter: `community_id=eq.${community.id}` },
          { table: 'community_reactions', filter: `community_id=eq.${community.id}` },
        ]
      : [],
    () => void load(),
  );

  const visible = useMemo(() => sortFeed(withoutBlocked(posts ?? [], blocked)), [posts, blocked]);
  const shown = useMemo(() => filterFeed(visible, filter, coaches), [visible, filter, coaches]);
  const myAvatarPaths = useMemo(() => [profile?.avatarPath ?? null], [profile]);
  const media = usePostMedia(visible, myAvatarPaths, blocked);
  const ctx: PostContext | null = community
    ? {
        me,
        workspaceId: community.workspaceId,
        coaches,
        blocked,
        units,
        now,
        onChanged: () => void load(),
        onBlocked: (id) => setBlocked(new Set([...blocked, id])),
      }
    : null;

  const badge = badgeLabel(unread);
  const subtitle = communitySubtitle(workspace?.workspaceName ?? null, members);
  const filters: { key: FeedFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'coach', label: coachFilterLabel([...coaches].map((id) => coachNames[id] ?? '')) },
    { key: 'wins', label: 'Wins' },
  ];
  const circle = [styles.circle, { borderRadius: radius.pill }];

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        loadExtras();
        void Promise.all([refresh(), load()]).finally(() => setRefreshing(false));
      }}
    >
      <View style={[styles.row, { gap: space[2.5] }]}>
        <Pressable
          testID="community-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/coach'))}
          style={({ pressed }) => [circle, pressed && { opacity: pressedOpacity }]}
        >
          <BackIcon />
        </Pressable>
        <View style={styles.flex} accessibilityRole="header" accessible accessibilityLabel={subtitle ? `Community, ${subtitle}` : 'Community'}>
          <Text style={text('screenTitle')}>Community</Text>
          {subtitle ? (
            <Text style={text('caption')} testID="community-subtitle" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {community ? (
          <Pressable
            testID="community-notifications"
            accessibilityRole="button"
            accessibilityLabel={badge ? `Notifications, ${badge} new` : 'Notifications'}
            onPress={() => router.push('/community/notifications')}
            style={({ pressed }) => [circle, pressed && { opacity: pressedOpacity }]}
          >
            <BellIcon />
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
        <View style={{ gap: space[3.5] }}>
          <View style={[styles.row, styles.shareBox, { borderRadius: radius.card, gap: space[2.5], paddingHorizontal: space[3], paddingVertical: space[2.5] }]}>
            <CoachAvatar name={profile?.name ?? 'You'} url={media.avatarOf(profile?.avatarPath ?? null)} size={40} ring={2} />
            <Pressable
              testID="community-new-post"
              accessibilityRole="button"
              accessibilityLabel="New post. Share a win or ask the group"
              onPress={() => router.push('/community/new')}
              style={({ pressed }) => [styles.shareText, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={[text('body'), styles.placeholder]}>Share a win or ask the group…</Text>
            </Pressable>
            <Pressable
              testID="community-new-photo"
              accessibilityRole="button"
              accessibilityLabel="New post with photos"
              onPress={() => router.push({ pathname: '/community/new', params: { photos: '1' } })}
              style={({ pressed }) => [circle, pressed && { opacity: pressedOpacity }]}
            >
              <PhotoIcon />
            </Pressable>
          </View>
          <Text style={text('caption')}>Only you, your coach and their clients can see this. Members see your name and photo.</Text>

          <View style={[styles.row, styles.wrap, { gap: space[2] }]} accessibilityRole="tablist" accessibilityLabel="Filter posts">
            {filters.map((f) => {
              const on = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  testID={`community-filter-${f.key}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFilter(f.key)}
                  style={({ pressed }) => [styles.filter, { borderRadius: radius.pill, paddingHorizontal: space[3.5] }, on && styles.filterOn, pressed && { opacity: pressedOpacity }]}
                >
                  <Text style={[text('sectionHeading'), on ? styles.filterOnText : styles.ink]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <ErrorText>{error}</ErrorText> : null}
          {posts === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading posts" /> : null}
          {posts !== null && visible.length === 0 ? (
            <Text style={text('body')} testID="community-empty">
              No posts yet. Say hello!
            </Text>
          ) : null}
          {posts !== null && visible.length > 0 && shown.length === 0 ? (
            <Text style={text('body')} testID="community-filter-empty">
              {filter === 'wins' ? 'No wins shared yet. Share a workout or a sticker!' : 'Nothing here yet.'}
            </Text>
          ) : null}
          {shown.map((p) => (
            <PostItem
              key={p.id}
              post={p}
              ctx={ctx}
              variant={p.pinnedAt ? 'pinned' : 'feed'}
              pinnerName={p.pinnedBy ? (coachNames[p.pinnedBy] ?? null) : null}
              avatarUrl={media.avatarUrl(p)}
              avatarOf={media.avatarOf}
              photoUrls={media.photos}
              fullUrls={media.fullUrl}
              onOpenComments={() => router.push({ pathname: '/community/[id]', params: { id: p.id } })}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1 },
  ink: { color: palette.ink },
  circle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  badge: { position: 'absolute', top: 0, right: 0, minWidth: 18, alignItems: 'center', backgroundColor: palette.magenta },
  badgeText: { color: white, fontFamily: fontFamilyFor('sans', 800) },
  shareBox: { borderWidth: 2, borderColor: palette.ink },
  shareText: { flex: 1, minHeight: 44, justifyContent: 'center' },
  placeholder: { color: palette.inkMuted },
  filter: { minHeight: 44, justifyContent: 'center', borderWidth: 1.5, borderColor: palette.ink, backgroundColor: palette.bg },
  filterOn: { backgroundColor: palette.ink, borderWidth: 2 },
  filterOnText: { color: white },
});
