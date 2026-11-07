import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  canBlock,
  canDelete,
  canReport,
  likersLine,
  postAge,
  type Units,
} from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { block, deletePost, report, setLiked, type FeedPost } from '@/lib/community-api';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { CardView, LinkedText } from './parts';
import { ChoiceSheet, PhotoViewer, type Choice } from './sheets';

export type PostContext = {
  me: string;
  workspaceId: string;
  coaches: Set<string>;
  units: Units;
  now: number;
  /** Something changed on the server: reload. */
  onChanged: () => void;
  /** I blocked someone: hide them at once. */
  onBlocked: (userId: string) => void;
};

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

/** The "…" menu, the report reasons and the block confirmation, shared by posts and comments. */
export function useContentMenu(ctx: PostContext) {
  const [sheet, setSheet] = useState<{ title: string; choices: Choice[] } | null>(null);

  const askBlock = (authorId: string, authorName: string) =>
    Alert.alert(`Block ${authorName}?`, 'You won’t see their posts, comments or likes. They won’t be told.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          void block(ctx.workspaceId, authorId)
            .then(() => ctx.onBlocked(authorId))
            .catch((e: unknown) => Alert.alert(errorText(e))),
      },
    ]);

  const askReport = (target: { postId?: string; commentId?: string }, authorId: string, authorName: string) =>
    setSheet({
      title: 'Why are you reporting this?',
      choices: REPORT_REASONS.map((reason) => ({
        label: REPORT_REASON_LABELS[reason],
        testID: `report-reason-${reason}`,
        onPress: () =>
          void report(target, reason)
            .then(() => {
              const mayBlock = canBlock({ userId: ctx.me, isCoach: false }, { id: authorId, isCoach: ctx.coaches.has(authorId) });
              Alert.alert(
                'Thanks for telling us',
                'Your coach will take a look.',
                mayBlock
                  ? [
                      { text: 'OK', style: 'cancel' },
                      { text: `Block ${authorName}`, style: 'destructive', onPress: () => askBlock(authorId, authorName) },
                    ]
                  : [{ text: 'OK' }],
              );
            })
            .catch((e: unknown) => Alert.alert(errorText(e))),
      })),
    });

  const open = (opts: { kind: 'post' | 'comment'; id: string; authorId: string; authorName: string; onDelete: () => Promise<void> }) => {
    const viewer = { userId: ctx.me, isCoach: ctx.coaches.has(ctx.me) };
    const choices: Choice[] = [];
    if (canReport(viewer, opts.authorId)) {
      choices.push({
        label: `Report ${opts.kind}`,
        testID: `menu-report`,
        onPress: () => askReport(opts.kind === 'post' ? { postId: opts.id } : { commentId: opts.id }, opts.authorId, opts.authorName),
      });
    }
    if (canBlock(viewer, { id: opts.authorId, isCoach: ctx.coaches.has(opts.authorId) })) {
      choices.push({ label: `Block ${opts.authorName}`, testID: 'menu-block', destructive: true, onPress: () => askBlock(opts.authorId, opts.authorName) });
    }
    if (canDelete(viewer, opts.authorId)) {
      choices.push({
        label: `Delete ${opts.kind}`,
        testID: 'menu-delete',
        destructive: true,
        onPress: () =>
          Alert.alert(`Delete this ${opts.kind}?`, undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void opts.onDelete().then(ctx.onChanged).catch((e: unknown) => Alert.alert(errorText(e))) },
          ]),
      });
    }
    setSheet({ title: opts.kind === 'post' ? 'Post' : 'Comment', choices });
  };

  const element = <ChoiceSheet title={sheet?.title ?? null} choices={sheet?.choices ?? []} onClose={() => setSheet(null)} />;
  return { open, element };
}

/** One post in the feed (or at the top of its own page). */
export function PostItem({
  post,
  ctx,
  avatarUrl,
  thumbUrls,
  fullUrls,
  onOpenComments,
}: {
  post: FeedPost;
  ctx: PostContext;
  avatarUrl: string | null;
  thumbUrls: Record<string, string>;
  fullUrls: (path: string) => Promise<string | null>;
  onOpenComments?: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [liked, setLikedState] = useState(post.likerIds.includes(ctx.me));
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const menu = useContentMenu(ctx);
  // The server's answer wins once the feed reloads.
  const [seen, setSeen] = useState(post.likerIds);
  if (seen !== post.likerIds) {
    setSeen(post.likerIds);
    setLikedState(post.likerIds.includes(ctx.me));
  }
  const others = post.likerNames.filter((_, i) => post.likerIds[i] !== ctx.me);
  const isCoach = ctx.coaches.has(post.authorId);

  const toggleLike = async () => {
    const next = !liked;
    setLikedState(next);
    setBusy(true);
    try {
      await setLiked(post.id, next);
      ctx.onChanged();
    } catch (e) {
      setLikedState(!next);
      Alert.alert(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[styles.post, { borderRadius: radius.card, padding: space[4], gap: space[3] }]}
      testID={`post-${post.id}`}
      accessibilityLabel={`Post by ${post.authorName}`}
    >
      <View style={[styles.row, { gap: space[3] }]}>
        <CoachAvatar name={post.authorName} url={avatarUrl} size={40} />
        <View style={styles.flex}>
          <Text style={text('sectionHeading')}>
            {post.authorName}
            {isCoach ? ' · Coach' : ''}
          </Text>
          <Text style={text('caption')}>
            {post.pinnedAt ? '📌 Pinned · ' : ''}
            {postAge(post.createdAt, ctx.now)}
          </Text>
        </View>
        <Pressable
          testID="post-menu"
          accessibilityRole="button"
          accessibilityLabel={`More options for ${post.authorName}’s post`}
          hitSlop={8}
          onPress={() => menu.open({ kind: 'post', id: post.id, authorId: post.authorId, authorName: post.authorName, onDelete: () => deletePost(post) })}
          style={({ pressed }) => [styles.menuButton, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={text('sectionHeading')}>•••</Text>
        </Pressable>
      </View>

      {post.body ? <LinkedText text={post.body} testID="post-body" /> : null}
      {post.card ? <CardView card={post.card} units={ctx.units} /> : null}
      {post.images.length > 0 ? (
        <View style={[styles.grid, { gap: space[2] }]}>
          {post.images.map((img, i) => {
            const uri = thumbUrls[img.thumbPath];
            return (
              <Pressable
                key={img.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo ${i + 1} of ${post.images.length}. Opens full size.`}
                testID={`post-photo-${i}`}
                onPress={() => void fullUrls(img.path).then((u) => u && setViewing(u))}
                style={[post.images.length === 1 ? styles.single : styles.half, { borderRadius: radius.input, aspectRatio: post.images.length === 1 ? img.width / img.height : 1 }]}
              >
                {uri ? (
                  <Image source={{ uri }} style={[styles.fill, { borderRadius: radius.input }]} resizeMode="cover" accessibilityIgnoresInvertColors />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.row, { gap: space[3] }]}>
        <Pressable
          testID="like-button"
          accessibilityRole="button"
          accessibilityState={{ selected: liked, busy }}
          accessibilityLabel={liked ? 'Unlike' : 'Like'}
          onPress={() => void toggleLike()}
          disabled={busy}
          style={({ pressed }) => [styles.action, { borderRadius: radius.pill, paddingHorizontal: space[3] }, liked && styles.liked, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={text('sectionHeading')}>{liked ? '♥' : '♡'} Like</Text>
        </Pressable>
        {onOpenComments ? (
          <Pressable
            testID="comments-button"
            accessibilityRole="button"
            onPress={onOpenComments}
            style={({ pressed }) => [styles.action, { borderRadius: radius.pill, paddingHorizontal: space[3] }, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('sectionHeading')}>
              💬 {post.commentCount > 0 ? `${post.commentCount} ${post.commentCount === 1 ? 'comment' : 'comments'}` : 'Comment'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {liked || others.length > 0 ? (
        <Text style={text('caption')} testID="likers">
          {likersLine(others, liked)}
        </Text>
      ) : null}
      {menu.element}
      <PhotoViewer url={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  post: { backgroundColor: palette.surface },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  menuButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  single: { width: '100%', overflow: 'hidden', backgroundColor: palette.bg, maxHeight: 420 },
  half: { width: '48.5%', overflow: 'hidden', backgroundColor: palette.bg },
  fill: { width: '100%', height: '100%' },
  action: { minHeight: 44, justifyContent: 'center', backgroundColor: palette.bg },
  liked: { backgroundColor: palette.pink },
});
