import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COMMENT_BODY_MAX, CommentInput, commentCountLabel, postAge, withoutBlocked } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { BackIcon } from '@/components/community/icons';
import { LinkedText } from '@/components/community/parts';
import { CoachBadge, PostItem, openPostMenu, useContentMenu, type PostContext } from '@/components/community/post-item';
import { useReactions } from '@/components/community/reactions';
import { usePostMedia } from '@/components/community/use-post-media';
import { ErrorText, Screen } from '@/components/ui';
import { addComment, deleteComment, loadComments, loadPost, type FeedComment, type FeedPost } from '@/lib/community-api';
import { useLive } from '@/lib/community-live';
import { useCommunity } from '@/lib/use-community';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';

/** One post with its reactions and comments, and a comment box pinned at the bottom. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const units = useUnits() ?? 'lb';
  const { community, coaches, blocked, setBlocked } = useCommunity();
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([loadPost(id), loadComments(id)]);
      setPost(p);
      setComments(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the post.');
      setPost((prev) => prev ?? null);
    }
    setNow(Date.now());
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useLive(
    community
      ? [
          // Deletes arrive as an update of the community row.
          { table: 'communities', filter: `id=eq.${community.id}` },
          { table: 'community_comments', filter: `post_id=eq.${id}` },
          { table: 'community_reactions', filter: `post_id=eq.${id}` },
          { table: 'community_posts', filter: `id=eq.${id}` },
        ]
      : [],
    () => void load(),
  );

  const visibleComments = useMemo(() => withoutBlocked(comments, blocked), [comments, blocked]);
  const posts = useMemo(() => (post ? [post] : []), [post]);
  const commentAvatars = useMemo(() => visibleComments.map((c) => c.authorAvatarPath), [visibleComments]);
  const media = usePostMedia(posts, commentAvatars);
  const ctx: PostContext | null = community
    ? {
        me,
        workspaceId: community.workspaceId,
        coaches,
        blocked,
        units,
        now,
        onChanged: () => void load(),
        onBlocked: (uid) => {
          setBlocked(new Set([...blocked, uid]));
          if (post?.authorId === uid) router.back();
        },
      }
    : null;
  // Hooks come before any early return.
  const fallbackCtx: PostContext = { me, workspaceId: '', coaches, blocked, units, now, onChanged: () => undefined, onBlocked: () => undefined };
  const menu = useContentMenu(ctx ?? fallbackCtx);
  // A deleted post leaves the page.
  const postMenu = useContentMenu({ ...(ctx ?? fallbackCtx), onChanged: () => (router.canGoBack() ? router.back() : router.replace('/community')) });
  const showPost = post && ctx && !blocked.has(post.authorId);

  const send = async () => {
    const parsed = CommentInput.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Write a comment first.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await addComment(id, parsed.data);
      setDraft('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add the comment.');
    } finally {
      setSending(false);
    }
  };

  const circle = [styles.circle, { borderRadius: radius.pill }];
  const footer = post ? (
    <View style={{ gap: space[1] }}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={[styles.row, { gap: space[2] }]}>
        <TextInput
          testID="comment-input"
          accessibilityLabel="Write a comment"
          placeholder="Write a comment…"
          placeholderTextColor={palette.inkMuted}
          multiline
          maxLength={COMMENT_BODY_MAX}
          value={draft}
          onChangeText={setDraft}
          style={[text('body'), styles.input, { borderRadius: radius.pill, paddingHorizontal: space[3.5], paddingVertical: space[2.5] }]}
        />
        <Pressable
          testID="comment-send"
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: sending || !draft.trim(), busy: sending }}
          disabled={sending || !draft.trim()}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.send,
            { borderRadius: radius.pill, paddingHorizontal: space[4] },
            (sending || !draft.trim()) && styles.sendOff,
            pressed && { opacity: pressedOpacity },
          ]}
        >
          {sending ? <ActivityIndicator color={palette.ink} /> : <Text style={[text('sectionHeading'), styles.ink]}>Post</Text>}
        </Pressable>
      </View>
    </View>
  ) : undefined;

  return (
    <Screen footer={footer}>
      <View style={[styles.row, { gap: space[2.5] }]}>
        <Pressable
          testID="post-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Community"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/community'))}
          style={({ pressed }) => [circle, pressed && { opacity: pressedOpacity }]}
        >
          <BackIcon />
        </Pressable>
        <Text style={[text('sectionHeading'), styles.title, styles.flex]} accessibilityRole="header">
          Post
        </Text>
        {showPost ? (
          <Pressable
            testID="post-menu"
            accessibilityRole="button"
            accessibilityLabel={`More options for ${post.authorName}’s post`}
            onPress={() => openPostMenu(postMenu, post)}
            style={({ pressed }) => [circle, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('sectionHeading')}>•••</Text>
          </Pressable>
        ) : null}
      </View>
      {post === undefined ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {post === null ? <Text style={text('sectionHeading')}>This post isn’t available any more.</Text> : null}
      {showPost ? (
        <PostItem post={post} ctx={ctx} variant="detail" avatarUrl={media.avatarUrl(post)} photoUrls={media.photos} fullUrls={media.fullUrl} />
      ) : null}

      {post ? (
        <View style={{ gap: space[3] }}>
          <Text style={[text('caption'), styles.eyebrow]} accessibilityRole="header">
            {visibleComments.length === 0 ? 'Comments' : commentCountLabel(visibleComments.length)}
          </Text>
          {visibleComments.length === 0 ? <Text style={text('caption')}>No comments yet. Be the first!</Text> : null}
          {visibleComments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              me={me}
              isCoach={coaches.has(c.authorId)}
              avatarUrl={media.avatarOf(c.authorAvatarPath)}
              now={now}
              onChanged={() => void load()}
              onMenu={() => menu.open({ kind: 'comment', id: c.id, authorId: c.authorId, authorName: c.authorName, onDelete: () => deleteComment(c.id) })}
            />
          ))}
        </View>
      ) : null}
      {menu.element}
      {postMenu.element}
    </Screen>
  );
}

/** One comment as a bubble beside its author's photo: press and hold (or "+") to react. */
function CommentItem({
  comment: c,
  me,
  isCoach,
  avatarUrl,
  now,
  onChanged,
  onMenu,
}: {
  comment: FeedComment;
  me: string;
  isCoach: boolean;
  avatarUrl: string | null;
  now: number;
  onChanged: () => void;
  onMenu: () => void;
}) {
  const { text, space } = useTheme();
  const reactions = useReactions({ target: { commentId: c.id }, rows: c.reactions, me, onChanged });
  return (
    <Pressable accessible={false} onLongPress={reactions.openPicker} style={[styles.commentRow, { gap: space[2.5] }]} testID={`comment-${c.id}`}>
      <CoachAvatar name={c.authorName} url={avatarUrl} size={34} ring={2} />
      <View style={[styles.flex, { gap: space[1] }]}>
        <View style={[styles.bubble, { paddingVertical: space[2], paddingLeft: space[3], gap: 2 }]}>
          <View style={styles.row}>
            <View style={[styles.row, styles.wrap, styles.flex, { gap: space[1] }]}>
              <Text style={text('sectionHeading')}>{c.authorName}</Text>
              {isCoach ? <CoachBadge /> : null}
              <Text style={text('caption')}>· {postAge(c.createdAt, now)}</Text>
            </View>
            <Pressable
              testID="comment-menu"
              accessibilityRole="button"
              accessibilityLabel={`More options for ${c.authorName}’s comment`}
              onPress={onMenu}
              hitSlop={{ top: 10, bottom: 10 }}
              style={({ pressed }) => [styles.menuButton, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={text('body')}>•••</Text>
            </Pressable>
          </View>
          <View style={{ paddingRight: space[3] }}>
            <LinkedText text={c.body} />
          </View>
        </View>
        {reactions.bar}
      </View>
      {reactions.picker}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1 },
  title: { fontSize: 18, fontFamily: fontFamilyFor('sans', 800) },
  eyebrow: { fontFamily: fontFamilyFor('sans', 800), textTransform: 'uppercase', letterSpacing: 0.6 },
  circle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bubble: { backgroundColor: palette.surface, borderTopLeftRadius: 4, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  // Drawn small so the bubble stays tight (as in the mockup); the 44 pt tap area comes from hitSlop.
  menuButton: { minWidth: 44, height: 24, alignItems: 'center', justifyContent: 'center' },
  ink: { color: palette.ink },
  send: { minHeight: 44, justifyContent: 'center', borderWidth: 2, borderColor: palette.ink, backgroundColor: palette.lime },
  sendOff: { opacity: 0.5 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1.5, borderColor: palette.ink, color: palette.ink, textAlignVertical: 'center' },
});
