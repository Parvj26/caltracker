import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COMMUNITY_BUCKET, initialsOf, localToday, type Units } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { useSignedUrls } from '@/components/community/parts';
import { Sticker } from '@/components/stickers/sticker';
import { Button, TextButton } from '@/components/ui';
import { shareHref } from '@/lib/community-share';
import { useSession } from '@/lib/session';
import { fetchLatestPosts, fetchShareCandidate, readCachedPosts } from '@/lib/today-api';
import { coachPreview, postPreview, previewTime, seeAllLabel, shareWorkoutTitle, unreadLabel, type PostPreview } from '@/lib/today-logic';
import { useCachedLoad } from '@/lib/use-cached-load';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useCommunity } from '@/lib/use-community';
import { useMessages } from '@/lib/use-messages';
import { useSharedWorkouts } from '@/lib/shared-workouts';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { CountBadge, Note, Row, Tile } from './parts';

const THUMB = 56;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** The coach row: avatar, the latest message with its time, and the unread count. Opens the Coach tab. */
export function CoachRow() {
  const { text, space } = useTheme();
  const router = useRouter();
  const chat = useMessages();
  const coach = useCoachProfile();
  const preview = useMemo(() => (chat ? coachPreview(chat.items, chat.me) : null), [chat]);
  // No coach chat (no coach link): there is no Coach tab either.
  if (!chat) return null;

  const time = preview ? previewTime(preview.at, new Date().toISOString(), zone()) : null;
  const line =
    preview?.text ??
    (chat.status === 'loading' ? 'Loading messages…' : chat.status === 'offline' ? 'Messages show when you’re online.' : 'Say hi to your coach');
  const unread = unreadLabel(chat.unread);
  const label = ['Your coach', preview ? `${preview.text}, ${time}` : line, unread].filter(Boolean).join('. ');

  return (
    <Tile onPress={() => router.navigate('/coach')} accessibilityLabel={label} accessibilityHint="Opens your chat" testID="today-coach">
      <Row style={{ gap: space[3.5] }}>
        <CoachAvatar name={coach?.name || 'Coach'} url={coach?.avatarUrl ?? null} size={44} />
        <View style={[styles.flex, { gap: space[1] }]}>
          <Row style={{ gap: space[2] }}>
            <Text style={[text('sectionHeading'), styles.flex]}>Your coach</Text>
            {time ? <Text style={text('caption')}>{time}</Text> : null}
          </Row>
          <Text style={[text('body'), styles.muted]} numberOfLines={1} testID="today-coach-preview">
            {line}
          </Text>
        </View>
        <CountBadge count={chat.unread} />
      </Row>
    </Tile>
  );
}

/**
 * The community card: the two newest posts (by time, pinned or not), the new notifications, and "Share <day>'s
 * workout" when my last finished workout is from today or yesterday, has its award on the server and isn't shared yet
 * (the same composer as the summary's Share).
 */
export function CommunityCard({ units, refreshKey }: { units: Units; refreshKey: number }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const me = session?.user.id ?? null;
  const { community, ready, removed, offline, coaches, blocked, unread } = useCommunity();
  const communityId = community?.id ?? null;

  const posts = useCachedLoad(
    me && communityId ? `${me}:${communityId}` : null,
    () => (me && communityId ? readCachedPosts(me, communityId) : Promise.resolve(null)),
    () => (me && communityId ? fetchLatestPosts(me, communityId, blocked) : Promise.resolve([])),
    refreshKey,
  );
  // Never saved on the phone: offering to share needs the server anyway.
  const share = useCachedLoad(
    me && communityId ? `share:${me}:${communityId}` : null,
    () => Promise.resolve(null),
    () => (me ? fetchShareCandidate(me) : Promise.resolve(null)),
    refreshKey,
  );

  const sharedHere = useSharedWorkouts();
  const rows = useMemo(
    () => (posts.data && me ? posts.data.filter((p) => !blocked.has(p.authorId)).map((p) => postPreview(p, { me, coaches, units })) : []),
    [posts.data, me, blocked, coaches, units],
  );
  const thumbs = useSignedUrls(
    COMMUNITY_BUCKET,
    useMemo(() => rows.flatMap((r) => (r.thumbPath ? [r.thumbPath] : [])), [rows]),
  );

  // Taken out of the community by the coach: nothing to show here (the Community screen explains).
  if (ready && removed) return null;
  // Posts (even the copy saved on the phone) show only once membership is confirmed.
  const member = ready && !removed && community !== null;
  // Hidden for good once shared from this phone, even before (or without) the server saying so.
  const shareTitle =
    member && share.data && !sharedHere.has(share.data.logId) ? shareWorkoutTitle(share.data.finishedAt, localToday()) : null;

  return (
    <Tile testID="today-community">
      <Row style={{ gap: space[2] }}>
        <Text style={[text('sectionHeading'), styles.flex]} accessibilityRole="header">
          Community
        </Text>
        {community ? (
          <TextButton title={seeAllLabel(unread)} testID="today-community-all" onPress={() => router.push('/community')} />
        ) : null}
      </Row>

      {!ready ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading the community" /> : null}
      {ready && !community && offline ? <Note>The community shows when you’re online.</Note> : null}
      {member && posts.data === null && posts.status === 'loading' ? (
        <ActivityIndicator color={palette.ink} accessibilityLabel="Loading posts" />
      ) : null}
      {member && posts.data === null && posts.status === 'offline' ? <Note>Posts show when you’re online.</Note> : null}
      {member && posts.data !== null && rows.length === 0 ? <Note testID="today-community-empty">No posts yet. Say hello!</Note> : null}

      {(member ? rows : []).map((r) => (
        <PostRow
          key={r.id}
          row={r}
          thumbUrl={r.thumbPath ? (thumbs[r.thumbPath] ?? null) : null}
          onPress={() => router.push({ pathname: '/community/[id]', params: { id: r.id } })}
        />
      ))}

      {shareTitle && share.data ? (
        <Button
          variant="secondary"
          title={shareTitle}
          testID="today-share-workout"
          onPress={() => share.data && router.push(shareHref({ kind: 'workout', logId: share.data.logId }))}
        />
      ) : null}
    </Tile>
  );
}

function PostRow({ row, thumbUrl, onPress }: { row: PostPreview; thumbUrl: string | null; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  const label = [row.author, row.snippet, row.stats].filter(Boolean).join('. ');
  return (
    <Pressable
      testID={`today-post-${row.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the post"
      style={({ pressed }) => [styles.post, { borderRadius: radius.button, padding: space[3], gap: space[3] }, pressed && styles.pressed]}
    >
      <View style={[styles.thumb, { borderRadius: radius.input }]}>
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={styles.thumbImage} accessible={false} />
        ) : row.stickerKey ? (
          <Sticker stickerKey={row.stickerKey} size={THUMB / 1.4} variant="sm" />
        ) : (
          <Text style={text('sectionHeading')}>{initialsOf(row.author.replace(/ · Coach$/, ''))}</Text>
        )}
      </View>
      <View style={[styles.flex, { gap: space[1] / 2 }]}>
        <Text style={text('sectionHeading')} numberOfLines={1}>
          {row.author}
        </Text>
        {row.snippet ? (
          <Text style={[text('body'), styles.muted]} numberOfLines={2}>
            {row.snippet}
          </Text>
        ) : null}
        {row.stats ? <Text style={text('caption')}>{row.stats}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  muted: { color: palette.inkMuted },
  pressed: { opacity: pressedOpacity },
  post: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.bg },
  thumb: { width: THUMB, height: THUMB, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.drop },
  thumbImage: { width: THUMB, height: THUMB },
});
