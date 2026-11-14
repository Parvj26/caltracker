'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { COMMENT_BODY_MAX, cardText, postAge, splitLinks, type CommunityCard, type Units } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { SharpPhoto } from '@/components/sharp-photo';
import { MoreMenu } from '@/components/more-menu';
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

/** A pushpin line icon (decorative: the word "Pinned" or the menu label carries the meaning). */
function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 4h6l-1 6 4 4H6l4-4z" />
      <path d="M12 14v7" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

const countComments = (n: number) => `${n} ${n === 1 ? 'comment' : 'comments'}`;

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
  // Comments start folded ("3 comments"); Comment opens the box (and the comments above it).
  const [showComments, setShowComments] = useState(false);
  const [writing, setWriting] = useState(false);
  const [pending, startTransition] = useTransition();
  const commentsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (writing) inputRef.current?.focus();
  }, [writing]);

  const run = (action: () => Promise<CommunityOutcome>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await action();
      if (!r.ok) setError(r.code);
      else after?.();
    });
  const removePost = () => {
    if (window.confirm('Delete this post for everyone?')) run(() => deletePost(post.id));
  };
  const open = showComments || writing;
  const count = post.comments.length;

  return (
    <article className={styles.post} id={`post-${post.id}`} aria-label={`Post by ${post.authorName}`} data-testid="community-post">
      <header className={styles.postHeader}>
        <CoachAvatar url={post.authorAvatarUrl} name={post.authorName} seed={post.authorId} />
        <div className={styles.postWho}>
          <p className={styles.postAuthor}>
            {post.authorName} {post.authorIsCoach ? <Chip tone="lime">Coach</Chip> : null}
          </p>
          <p className={styles.postMeta}>
            {post.pinnedAt ? (
              <span className={styles.pinned}>
                <PinIcon />
                <span>Pinned</span>
                <span aria-hidden="true"> ·</span>
              </span>
            ) : null}
            <time dateTime={post.createdAt}>{postAge(post.createdAt, now)}</time>
          </p>
        </div>
        <MoreMenu
          label="More for this post"
          disabled={pending}
          items={[
            { label: post.pinnedAt ? 'Unpin' : 'Pin to top', icon: <PinIcon size={18} />, onSelect: () => run(() => setPinned(post.id, !post.pinnedAt)) },
            { label: 'Delete post…', danger: true, onSelect: removePost },
          ]}
        />
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

      <div className={styles.postActions}>
        <ReactionBar target={{ postId: post.id }} rows={post.reactions} viewer={viewer} label={`Reactions to ${post.authorName}’s post`} />
        <button type="button" className={styles.smallButton} aria-expanded={writing} onClick={() => setWriting((w) => !w)}>
          <CommentIcon />
          <span className={styles.buttonText}>Comment</span>
        </button>
        {count > 0 ? (
          <button
            type="button"
            className={styles.commentToggle}
            aria-expanded={open}
            aria-controls={commentsId}
            onClick={() => {
              if (open) {
                setShowComments(false);
                setWriting(false);
              } else setShowComments(true);
            }}
          >
            {countComments(count)}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={styles.toggleChevron}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>

      {open && count > 0 ? (
        <ul className={styles.comments} aria-label="Comments" id={commentsId}>
          {post.comments.map((c) => (
            <li key={c.id} className={styles.comment}>
              <div className={styles.commentTop}>
                <div className={styles.commentText}>
                  <p className={styles.commentBody}>
                    <strong>{c.authorName}</strong> <LinkedText text={c.body} />
                  </p>
                  <p className={styles.caption}>
                    <time dateTime={c.createdAt}>{postAge(c.createdAt, now)}</time>
                  </p>
                </div>
                <MoreMenu
                  label={`More for ${c.authorName}’s comment`}
                  disabled={pending}
                  items={[
                    {
                      label: 'Delete comment…',
                      danger: true,
                      onSelect: () => {
                        if (window.confirm('Delete this comment?')) run(() => deleteComment(c.id));
                      },
                    },
                  ]}
                />
              </div>
              <ReactionBar target={{ commentId: c.id }} rows={c.reactions} viewer={viewer} label={`Reactions to ${c.authorName}’s comment`} />
            </li>
          ))}
        </ul>
      ) : null}

      {writing ? (
        <form
          className={styles.commentForm}
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addComment(post.id, comment),
              () => {
                setComment('');
                setShowComments(true);
              },
            );
          }}
        >
          <label className={styles.commentLabel}>
            <span className={styles.visuallyHidden}>Comment on {post.authorName}’s post</span>
            <input
              ref={inputRef}
              className={styles.commentInput}
              value={comment}
              maxLength={COMMENT_BODY_MAX}
              placeholder="Write a comment…"
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <button type="submit" className={styles.smallButton} disabled={pending || !comment.trim()}>
            Send
          </button>
        </form>
      ) : null}
      {error ? <ErrorText code={error} /> : null}
    </article>
  );
}
