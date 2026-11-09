import { useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  canBlock,
  canDelete,
  canReport,
  commentCountLabel,
  commentPreview,
  photoDisplaySize,
  pinnedByLabel,
  postAge,
  reactionCountLabel,
  summarizeReactions,
  topReactionsLine,
  viewAllCommentsLabel,
  type Units,
} from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { SharpPhoto } from '@/components/photo/sharp-photo';
import { PREVIEW_COMMENTS, block, deletePost, report, type FeedPost, type PreviewComment } from '@/lib/community-api';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { PinIcon } from './icons';
import { CardView, LinkedText } from './parts';
import { useReactions } from './reactions';
import { ChoiceSheet, PhotoViewer, type Choice } from './sheets';

export type PostContext = {
  me: string;
  workspaceId: string;
  coaches: Set<string>;
  /** People I blocked: their comments stay out of the preview. */
  blocked: ReadonlySet<string>;
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
    Alert.alert(`Block ${authorName}?`, 'You won’t see their posts, comments or reactions. They won’t be told.', [
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

/** The black "Coach" label next to a coach's name. */
export function CoachBadge() {
  const { text, radius } = useTheme();
  return (
    <View style={[styles.coachBadge, { borderRadius: radius.pill }]} testID="coach-badge">
      <Text style={[text('caption'), styles.coachBadgeText]}>Coach</Text>
    </View>
  );
}

/** Name (with the Coach label) and age, beside the avatar. */
function AuthorRow({ name, isCoach, age, avatarUrl, size, menu }: { name: string; isCoach: boolean; age: string; avatarUrl: string | null; size: number; menu?: ReactNode }) {
  const { text, space } = useTheme();
  return (
    <View style={[styles.row, { gap: space[2.5] }]}>
      <CoachAvatar name={name} url={avatarUrl} size={size} />
      <View style={styles.flex} accessible accessibilityLabel={`${name}${isCoach ? ', coach' : ''}, ${age}`}>
        <View style={[styles.row, styles.wrap, { gap: space[1] }]}>
          <Text style={text('sectionHeading')}>{name}</Text>
          {isCoach ? <CoachBadge /> : null}
        </View>
        <Text style={text('caption')}>{age}</Text>
      </View>
      {menu}
    </View>
  );
}

/** One comment in the preview under a feed post: small avatar, bold name, text. */
function PreviewLine({ comment, avatarUrl }: { comment: PreviewComment; avatarUrl: string | null }) {
  const { text, space } = useTheme();
  return (
    <View style={[styles.previewLine, { gap: space[2] }]} testID={`preview-comment-${comment.id}`}>
      <CoachAvatar name={comment.authorName} url={avatarUrl} size={28} />
      <Text style={[text('body'), styles.flex]} numberOfLines={3}>
        <Text style={styles.bold}>{comment.authorName}</Text> {comment.body}
      </Text>
    </View>
  );
}

export type PostVariant = 'feed' | 'pinned' | 'detail';

/**
 * One post. In the feed ("feed", or "pinned" for the coach's pinned post on top) tapping it opens the post, and the
 * newest comments show under it; on its own page ("detail") it shows the full reaction chips.
 */
export function PostItem({
  post,
  ctx,
  variant = 'feed',
  avatarUrl,
  avatarOf,
  photoUrls,
  fullUrls,
  pinnerName = null,
  onOpenComments,
}: {
  post: FeedPost;
  ctx: PostContext;
  variant?: PostVariant;
  avatarUrl: string | null;
  /** Signed avatar link by profile photo path (for the comment preview). */
  avatarOf?: (path: string | null) => string | null;
  /** Signed links by storage path, for both the full photos and their thumbnails. */
  photoUrls: Record<string, string>;
  fullUrls: (path: string) => Promise<string | null>;
  /** Who pinned it, for "Pinned by …". */
  pinnerName?: string | null;
  onOpenComments?: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [viewing, setViewing] = useState<string | null>(null);
  const menu = useContentMenu(ctx);
  // Photos fill the card's width (measured; estimated from the window until then), at most 70% of the screen tall.
  const screen = useWindowDimensions();
  const [photosWidth, setPhotosWidth] = useState<number | null>(null);
  const photoBox = { maxWidth: photosWidth ?? Math.max(1, screen.width - 4 * space[4]), maxHeight: Math.round(screen.height * 0.7) };
  const isCoach = ctx.coaches.has(post.authorId);
  const reactions = useReactions({ target: { postId: post.id }, rows: post.reactions, me: ctx.me, onChanged: ctx.onChanged });
  const detail = variant === 'detail';
  const pinned = variant === 'pinned';
  const reactionTotal = summarizeReactions(reactions.rows, ctx.me).reduce((n, s) => n + s.count, 0);
  const preview = variant === 'feed' ? commentPreview(post.recentComments, ctx.blocked, PREVIEW_COMMENTS) : [];
  const viewAll = variant === 'feed' ? viewAllCommentsLabel(post.commentCount) : null;

  const menuButton = detail ? undefined : (
    <Pressable
      testID="post-menu"
      accessibilityRole="button"
      accessibilityLabel={`More options for ${post.authorName}’s post`}
      hitSlop={8}
      onPress={() => openPostMenu(menu, post)}
      style={({ pressed }) => [styles.menuButton, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={text('sectionHeading')}>•••</Text>
    </Pressable>
  );

  const pill = [styles.pill, { borderRadius: radius.pill, paddingHorizontal: space[3], gap: space[1] }];

  return (
    // Tap a feed post to open it; press and hold anywhere to react (the reaction button does the same, for screen
    // readers too).
    <Pressable
      accessible={false}
      onPress={detail ? undefined : onOpenComments}
      onLongPress={reactions.openPicker}
      style={[
        detail ? null : styles.post,
        pinned && styles.pinned,
        detail ? { gap: space[3] } : { borderRadius: radius.card, padding: space[3.5], gap: space[2.5] },
      ]}
      testID={`post-${post.id}`}
      accessibilityLabel={`Post by ${post.authorName}`}
    >
      {pinned ? (
        <View style={[styles.row, { gap: 6 }]} testID="post-pinned">
          <PinIcon />
          <Text style={[text('caption'), styles.eyebrow]}>{pinnedByLabel(pinnerName)}</Text>
        </View>
      ) : null}
      <AuthorRow name={post.authorName} isCoach={isCoach} age={postAge(post.createdAt, ctx.now)} avatarUrl={avatarUrl} size={detail ? 44 : 40} menu={menuButton} />

      {post.body ? <LinkedText text={post.body} testID="post-body" /> : null}
      {post.card ? <CardView card={post.card} units={ctx.units} authorName={post.authorName} /> : null}
      {post.images.length > 0 ? (
        <View style={{ gap: space[2] }} onLayout={(e) => setPhotosWidth(Math.round(e.nativeEvent.layout.width))} testID="post-photos">
          {post.images.map((img, i) => (
            // Each photo whole, at its own shape, one under the other: nothing is cropped.
            <Pressable
              key={img.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Photo ${i + 1} of ${post.images.length}. Opens full size.`}
              testID={`post-photo-${i}`}
              onPress={() => void fullUrls(img.path).then((u) => u && setViewing(u))}
              style={({ pressed }) => [styles.photo, pressed && { opacity: pressedOpacity }]}
            >
              <SharpPhoto
                full={photoUrls[img.path]}
                thumb={photoUrls[img.thumbPath]}
                size={photoDisplaySize(img, photoBox)}
                radius={radius.input}
                testID={`post-photo-${i}-image`}
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      {detail ? reactions.bar : null}
      {pinned ? (
        <Pressable
          testID="comments-button"
          accessibilityRole="button"
          accessibilityLabel={`${reactionCountLabel(reactionTotal)}, ${commentCountLabel(post.commentCount)}. Opens the post.`}
          onPress={onOpenComments}
          style={({ pressed }) => [styles.countsLine, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={[text('sectionHeading'), styles.counts]}>
            {reactionCountLabel(reactionTotal)} · {commentCountLabel(post.commentCount)}
          </Text>
        </Pressable>
      ) : null}
      {variant === 'feed' ? (
        <View style={[styles.row, { gap: space[2] }]}>
          <Pressable
            testID="reaction-pill"
            accessibilityRole="button"
            accessibilityLabel={`${reactionCountLabel(reactionTotal)}. Add a reaction`}
            accessibilityHint="Or press and hold the post"
            onPress={reactions.openPicker}
            style={({ pressed }) => [pill, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('sectionHeading')}>{reactionTotal > 0 ? topReactionsLine(reactions.rows, 2) : '☺+ React'}</Text>
          </Pressable>
          <Pressable
            testID="comments-button"
            accessibilityRole="button"
            accessibilityLabel={`${commentCountLabel(post.commentCount)}. Opens the post.`}
            onPress={onOpenComments}
            style={({ pressed }) => [pill, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('sectionHeading')}>💬 {post.commentCount > 0 ? post.commentCount : 'Comment'}</Text>
          </Pressable>
        </View>
      ) : null}
      {preview.length > 0 || viewAll ? (
        <View style={[styles.preview, { gap: 6, paddingTop: space[2] }]} testID="comment-preview">
          {preview.map((c) => (
            <PreviewLine key={c.id} comment={c} avatarUrl={avatarOf?.(c.authorAvatarPath) ?? null} />
          ))}
          {viewAll ? (
            <Pressable
              testID="view-all-comments"
              accessibilityRole="button"
              onPress={onOpenComments}
              style={({ pressed }) => [styles.viewAll, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={[text('sectionHeading'), styles.counts]}>{viewAll}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {menu.element}
      {reactions.picker}
      <PhotoViewer url={viewing} onClose={() => setViewing(null)} />
    </Pressable>
  );
}

/** The post's "…" menu (report, block, delete), as the feed and the post page both open it. */
export function openPostMenu(menu: ReturnType<typeof useContentMenu>, post: FeedPost) {
  menu.open({ kind: 'post', id: post.id, authorId: post.authorId, authorName: post.authorName, onDelete: () => deletePost(post) });
}

const styles = StyleSheet.create({
  post: { backgroundColor: palette.bg, borderWidth: 2, borderColor: palette.border },
  pinned: { backgroundColor: palette.celebrateBg, borderColor: palette.ink },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1 },
  bold: { fontWeight: '800' },
  eyebrow: { color: palette.ink, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  coachBadge: { backgroundColor: palette.ink, paddingHorizontal: 6, paddingVertical: 1 },
  coachBadgeText: { color: white, fontWeight: '800' },
  menuButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  photo: { alignSelf: 'center' },
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface },
  countsLine: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  counts: { color: palette.ink },
  preview: { borderTopWidth: 1.5, borderTopColor: palette.border },
  previewLine: { flexDirection: 'row', alignItems: 'flex-start' },
  viewAll: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
