'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadUnreadTotal } from './messages/data';
import { useBrowserSupabase, useChanges, useOnWake } from './messages/use-realtime';
import { NavLink } from './nav-link';

/**
 * The coach's unread message total. It starts from the server's count and stays right on its own: Realtime events for
 * new messages and for the coach's own reads, and a refetch whenever the window wakes up.
 */
export function useUnreadTotal(userId: string, workspaceId: string, initial: number): number {
  const supabase = useBrowserSupabase();
  const [count, setCount] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setCount(initial);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refetch = useCallback(() => {
    loadUnreadTotal(supabase, workspaceId, userId).then(setCount, () => {
      // Keep the last number; the next event or focus tries again.
    });
  }, [supabase, workspaceId, userId]);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, 150);
  }, [refetch]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useChanges(
    supabase,
    'nav-unread',
    [
      { table: 'messages', filter: `workspace_id=eq.${workspaceId}` },
      { table: 'conversation_reads', filter: `user_id=eq.${userId}` },
    ],
    { onChange: soon, onReady: refetch },
  );
  useOnWake(refetch);
  return count;
}

/** The unread total, shared by the Inbox item and the phone menu button (provided by CoachSidebar). */
export const UnreadTotalContext = createContext(0);

/** The Inbox menu item with the unread total. */
export function MessagesNavLink() {
  const count = useContext(UnreadTotalContext);
  return <NavLink href="/messages" label="Inbox" icon="messages" badge={count} />;
}
