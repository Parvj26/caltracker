'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useState, useTransition } from 'react';
import { COMMENT_BODY_MAX, cardText, postAge, splitLinks, type CommunityCard, type Units } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { SharpPhoto } from '@/components/sharp-photo';
import { Chip, ErrorText } from '@/components/ui';
import { addComment, deleteComment, deletePost, setPinned, type CommunityOutcome } from './actions';
import type { FeedPost } from './data';
import { ReactionBar } from './reaction-bar';
import styles from './community.module.css';

/** Post text with http(s) links made clickable (opened in a new tab, without passing the page along). */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((s, i) =>
        s.kind === 'link' ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** The sentence about the poster is the headline; the workout's name and counts are small text under it. */
function CardView({ card, units, authorName }: { card: CommunityCard; units: Units; authorName: string }) {
  const t = cardText(card, units, authorName);
  return (
    <div className={styles.shareCard} data-testid="share-card">
      {t.stickerKey ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/stickers/${t.stickerKey}-sm.webp`} alt="" width={72} height={72} className={t.shiny ? styles.shiny : undefined} />
      ) : null}
      <div className={styles.shareCardText}>
        {t.badge ? <p className={styles.shareBadge}>{t.badge}</p> : null}
        <p className={styles.shareTitle} data-testid="share-card-headline">
          {t.title}
        </p>
        {t.lines.map((l, i) => (
          <p key={`${i}-${l}`} className={styles.shareLine}>
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

export function PostCard({
  post,
  viewer,
  units,
  now,
}: {
  post: FeedPost;
  viewer: { userId: string; name: string };
  units: Units;
  now: number;
}) {
  const [error, setError] = useState<ErrorCode | null>(null);
  const [comment, setComment] = useState('');
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<CommunityOutcome>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await action();
      if (!r.ok) setError(r.code);
      else after?.();
    });

  return (
    <article className={styles.post} id={`post-${post.id}`} aria-label={`Post by ${post.authorName}`} data-testid="community-post">
      <header className={styles.postHeader}>
        <CoachAvatar url={post.authorAvatarUrl} name={post.authorName} seed={post.authorId} />
        <div className={styles.postWho}>
          <p className={styles.postAuthor}>
            {post.authorName} {post.authorIsCoach ? <Chip tone="lime">Coach</Chip> : null}
            {post.pinnedAt ? <Chip tone="amber">Pinned</Chip> : null}
          </p>
          <p className={styles.caption}>
            <time dateTime={post.createdAt}>{postAge(post.createdAt, now)}</time>
          </p>
        </div>
        <div className={styles.postTools}>
          <button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(() => setPinned(post.id, !post.pinnedAt))}>
            {post.pinnedAt ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            className={styles.smallButton}
            disabled={pending}
            onClick={() => {
              if (window.confirm('Delete this post for everyone?')) run(() => deletePost(post.id));
            }}
          >
            Delete
          </button>
        </div>
      </header>

      {post.body ? (
        <p className={styles.postBody}>
          <LinkedText text={post.body} />
        </p>
      ) : null}
      {post.card ? <CardView card={post.card} units={units} authorName={post.authorName} /> : null}
      {post.images.length > 0 ? (
        // Each photo whole, at its own shape, one under the other (no crop); very tall ones are capped at 80% of the window.
        <ul className={styles.photoStack} aria-label="Photos">
          {post.images.map((img, i) => (
            <li key={img.id}>
              {img.fullUrl ? (
                <a className={styles.photoLink} href={img.fullUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open photo ${i + 1} full size`}>
                  <SharpPhoto full={img.fullUrl} thumb={img.thumbUrl ?? undefined} alt={`Photo ${i + 1}`} width={img.width} height={img.height} maxHeight="80vh" />
                </a>
              ) : (
                <span className={styles.caption}>Photo unavailable</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <ReactionBar target={{ postId: post.id }} rows={post.reactions} viewer={viewer} label={`Reactions to ${post.authorName}’s post`} />

      {post.comments.length > 0 ? (
        <ul className={styles.comments} aria-label="Comments">
          {post.comments.map((c) => (
            <li key={c.id} className={styles.comment}>
              <p className={styles.commentBody}>
                <strong>{c.authorName}</strong> <LinkedText text={c.body} />
              </p>
              <p className={styles.caption}>
                <time dateTime={c.createdAt}>{postAge(c.createdAt, now)}</time>
                {' · '}
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm('Delete this comment?')) run(() => deleteComment(c.id));
                  }}
                >
                  Delete comment
                </button>
              </p>
              <ReactionBar target={{ commentId: c.id }} rows={c.reactions} viewer={viewer} label={`Reactions to ${c.authorName}’s comment`} />
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className={styles.commentForm}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addComment(post.id, comment), () => setComment(''));
        }}
      >
        <label className={styles.commentLabel}>
          <span className={styles.visuallyHidden}>Comment on {post.authorName}’s post</span>
          <input
            className={styles.commentInput}
            value={comment}
            maxLength={COMMENT_BODY_MAX}
            placeholder="Write a comment…"
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <button type="submit" className={styles.smallButton} disabled={pending || !comment.trim()}>
          Comment
        </button>
      </form>
      {error ? <ErrorText code={error} /> : null}
    </article>
  );
}
