'use client';

import { breakpoints } from '@caltracker/design-tokens';
import { useRouter } from 'next/navigation';
import { useContext, useEffect } from 'react';
import { useMediaQuery } from '@/lib/use-media-query';
import { FirstConversationContext, UnreadPeopleContext } from './inbox';
import styles from './messages.module.css';

/**
 * The right-hand pane before a conversation is picked: what's waiting and how to start, instead of a blank 60% of the
 * screen (UX review C). It counts conversations with unread messages. On a wide screen (iPad in landscape, desktop:
 * 1000 px and up) with nothing unread, it opens the latest conversation in its place (the address is replaced, so Back
 * doesn't land on the empty pane again); with something unread it stays, so the coach picks who to read first.
 */
export function InboxEmptyPane() {
  const unread = useContext(UnreadPeopleContext);
  const first = useContext(FirstConversationContext);
  const wide = useMediaQuery(`(min-width: ${breakpoints.split}px)`);
  const router = useRouter();
  useEffect(() => {
    if (wide && first) router.replace(`/messages/${first}${window.location.search}`);
  }, [wide, first, router]);
  return (
    <div className={styles.emptyPane}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 5h16v11H9l-5 4z" />
      </svg>
      <p className={styles.emptyTitle}>{unread > 0 ? `${unread} ${unread === 1 ? 'conversation' : 'conversations'} with unread messages` : 'You’re all caught up'}</p>
      <p className={styles.placeholder}>
        {unread > 0 ? 'Pick a client on the left to read and reply. Use Unread to see only those.' : 'Pick a client on the left to see your conversation, or search for one.'}
      </p>
    </div>
  );
}
