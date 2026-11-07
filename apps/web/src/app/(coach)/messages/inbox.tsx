'use client';

import Link from 'next/link';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayLabel } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { avatarTone, initials } from '../clients/avatar';
import { badgeText, filterInbox, type InboxRow } from './model';
import { clockTime, useNow, useTimeZone } from './time';
import { useBrowserSupabase, useChanges, useOnWake } from './use-realtime';
import styles from './messages.module.css';

/** Today shows the time; any other day shows its short label ("Yesterday", "Mon 2 Nov"). */
function RowTime({ iso, now }: { iso: string; now: string }) {
  const timeZone = useTimeZone();
  const label = dayLabel(iso, now, timeZone);
  return <time dateTime={iso} className={styles.rowTime}>{label === 'Today' ? clockTime(iso, timeZone) : label}</time>;
}

/**
 * The two panes: the inbox (current clients, latest message first) and, beside it, the open conversation (the
 * route's page). Under 900 px only one shows at a time. The server sends the rows; Realtime events and focus ask the
 * server for fresh ones, so the list stays right while the window is open.
 */
export function MessagesShell({
  rows,
  userId,
  workspaceId,
  children,
}: {
  rows: InboxRow[];
  userId: string;
  workspaceId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const segment = useSelectedLayoutSegment();
  const supabase = useBrowserSupabase();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [now, refreshNow] = useNow();

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const joined = useRef(false);
  const refresh = useCallback(() => {
    refreshNow();
    router.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshNow is recreated each render; router is stable
  }, [router]);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 200);
  }, [refresh]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useChanges(
    supabase,
    'inbox',
    [
      { table: 'messages', filter: `workspace_id=eq.${workspaceId}` },
      { table: 'conversation_reads', filter: `user_id=eq.${userId}` },
    ],
    {
      onChange: soon,
      // The first join is the page load itself; later ones are reconnects, which may have missed events.
      onReady: () => {
        if (joined.current) refresh();
        joined.current = true;
      },
    },
  );
  useOnWake(refresh);

  const shown = useMemo(() => filterInbox(rows, { unreadOnly, query }), [rows, unreadOnly, query]);

  return (
    <div className={styles.shell} data-screen={segment ? 'thread' : 'list'}>
      <section className={cx(styles.pane, styles.inboxPane)} aria-labelledby="inbox-heading">
        <div className={styles.inboxHead}>
          <h1 id="inbox-heading" className={styles.heading}>Inbox</h1>
          <div className={styles.filters}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search clients"
              aria-label="Search clients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className={styles.toggle} aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
              Unread
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className={styles.empty}>
            {rows.length === 0 ? 'No clients yet. Invite one from Clients.' : unreadOnly ? 'Nothing unread.' : 'No clients match.'}
          </p>
        ) : (
          <ul className={styles.list} aria-label="Conversations">
            {shown.map((r) => (
              <li key={r.clientId}>
                <Link
                  href={`/messages/${r.clientId}`}
                  className={cx(styles.row, r.unread > 0 && styles.rowUnread, segment === r.clientId && styles.rowCurrent)}
                  aria-current={segment === r.clientId ? 'page' : undefined}
                  aria-label={r.unread > 0 ? `${r.name}, ${r.unread} unread` : r.name}
                  data-unread={r.unread}
                >
                  <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(r.clientId)}`])}>
                    {initials(r.name)}
                  </span>
                  <span className={styles.rowName}>{r.name}</span>
                  {r.lastMessageAt ? <RowTime iso={r.lastMessageAt} now={now} /> : <span />}
                  <span className={styles.preview}>{r.preview ? `${r.lastFromMe ? 'You: ' : ''}${r.preview}` : 'No messages yet'}</span>
                  {r.unread > 0 ? <span className={styles.count} aria-hidden="true">{badgeText(r.unread)}</span> : <span />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={cx(styles.pane, styles.threadPane)} aria-label="Conversation">
        {children}
      </section>
    </div>
  );
}
