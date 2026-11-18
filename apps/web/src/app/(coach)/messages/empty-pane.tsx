'use client';

import { useContext } from 'react';
import { UnreadPeopleContext } from './inbox';
import styles from './messages.module.css';

/**
 * The right-hand pane before a conversation is picked: what's waiting and how to start, instead of a blank 60% of the
 * screen (UX review C). It counts conversations with unread messages.
 */
export function InboxEmptyPane() {
  const unread = useContext(UnreadPeopleContext);
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
