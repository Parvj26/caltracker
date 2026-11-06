import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COMMENT_BODY_MAX, CommentInput, postAge, withoutBlocked } from '@caltracker/shared';
import { LinkedText } from '@/components/community/parts';
import { PostItem, useContentMenu, type PostContext } from '@/components/community/post-item';
import { usePostMedia } from '@/components/community/use-post-media';
import { Button, ErrorText, Screen, TextButton } from '@/components/ui';
import { addComment, deleteComment, loadComments, loadPost, type FeedComment, type FeedPost } from '@/lib/community-api';
import { useLive } from '@/lib/community-live';
import { useCommunity } from '@/lib/use-community';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** One post with its comments, and a box to add one. */
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
          { table: 'community_comments', filter: `post_id=eq.${id}`, deletes: true },
          { table: 'community_likes', filter: `post_id=eq.${id}`, deletes: true },
          { table: 'community_posts', filter: `id=eq.${id}`, deletes: true },
        ]
      : [],
    () => void load(),
  );

  const posts = useMemo(() => (post ? [post] : []), [post]);
  const media = usePostMedia(posts);
  const ctx: PostContext | null = community
    ? {
        me,
        workspaceId: community.workspaceId,
        coaches,
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
  const fallbackCtx: PostContext = { me, workspaceId: '', coaches, units, now, onChanged: () => undefined, onBlocked: () => undefined };
  const menu = useContentMenu(ctx ?? fallbackCtx);
  const visibleComments = withoutBlocked(comments, blocked);

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

  return (
    <Screen>
      <View style={styles.row}>
        <TextButton title="Back" testID="post-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community'))} />
      </View>
      {post === undefined ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {post === null ? <Text style={text('sectionHeading')}>This post isn’t available any more.</Text> : null}
      {post && ctx && !blocked.has(post.authorId) ? (
        <PostItem post={post} ctx={ctx} avatarUrl={media.avatarUrl(post)} thumbUrls={media.thumbs} fullUrls={media.fullUrl} />
      ) : null}

      {post ? (
        <View style={{ gap: space[3] }}>
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Comments
          </Text>
          {visibleComments.length === 0 ? <Text style={text('caption')}>No comments yet.</Text> : null}
          {visibleComments.map((c) => (
            <View key={c.id} style={[styles.comment, { borderRadius: radius.input, padding: space[3], gap: space[1] }]} testID={`comment-${c.id}`}>
              <View style={styles.row}>
                <Text style={[text('sectionHeading'), styles.flex]}>
                  {c.authorName}
                  {coaches.has(c.authorId) ? ' · Coach' : ''}
                </Text>
                <Pressable
                  testID="comment-menu"
                  accessibilityRole="button"
                  accessibilityLabel={`More options for ${c.authorName}’s comment`}
                  hitSlop={8}
                  onPress={() => menu.open({ kind: 'comment', id: c.id, authorId: c.authorId, authorName: c.authorName, onDelete: () => deleteComment(c.id) })}
                  style={({ pressed }) => [styles.menuButton, pressed && { opacity: pressedOpacity }]}
                >
                  <Text style={text('body')}>•••</Text>
                </Pressable>
              </View>
              <LinkedText text={c.body} />
              <Text style={text('caption')}>{postAge(c.createdAt, now)}</Text>
            </View>
          ))}
          <TextInput
            testID="comment-input"
            accessibilityLabel="Write a comment"
            placeholder="Write a comment…"
            placeholderTextColor={palette.inkMuted}
            multiline
            maxLength={COMMENT_BODY_MAX}
            value={draft}
            onChangeText={setDraft}
            style={[text('body'), styles.input, { borderRadius: radius.input, padding: space[3] }]}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title="Comment" testID="comment-send" busy={sending} disabled={!draft.trim()} onPress={() => void send()} />
        </View>
      ) : null}
      {menu.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  comment: { backgroundColor: palette.surface },
  menuButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 2, borderColor: palette.border, minHeight: 64, textAlignVertical: 'top', color: palette.ink },
});
