'use client';

import { useState, useTransition } from 'react';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, TextAreaField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { LocalDateTime } from '@/app/(coach)/activity/local-date-time';
import { addComment, deleteComment } from './actions';
import styles from './log.module.css';

export type CommentView = { id: string; body: string; createdAt: string; authorName: string; mine: boolean };

export function Comments({ logId, comments }: { logId: string; comments: CommentView[] }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => ReturnType<typeof addComment>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await action();
        if (!outcome.ok) setError(outcome.error);
        else onOk?.();
      } catch (e) {
        setError(failureMessage(e, "Couldn't save. Check your connection and try again."));
      }
    });
  }

  return (
    <section className={styles.section} aria-label="Comments">
      <h2 className={styles.sectionHeading}>Comments</h2>
      {comments.length === 0 ? <p className={styles.caption}>No comments yet.</p> : null}
      <ul className={styles.comments}>
        {comments.map((c) => (
          <li key={c.id} className={styles.comment}>
            <p className={styles.commentMeta}>
              {c.authorName} · <LocalDateTime iso={c.createdAt} />
            </p>
            <p className={styles.commentBody}>{c.body}</p>
            {c.mine ? (
              <button
                type="button"
                className={styles.smallButton}
                disabled={pending}
                onClick={() => {
                  if (window.confirm('Delete this comment?')) run(() => deleteComment(c.id));
                }}
              >
                Delete comment
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <TextAreaField label="Comment" value={body} maxLength={1000} rows={3} onChange={(e) => setBody(e.target.value)} />
      <div className={styles.saveBar}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
        <Button pending={pending} onClick={() => run(() => addComment({ logId, body }), () => setBody(''))}>
          {pending ? 'Posting…' : 'Post comment'}
        </Button>
      </div>
    </section>
  );
}
