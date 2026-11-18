'use client';

import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayLabel } from '@caltracker/shared';
import { ListRow, RowList, SearchBox, SearchEmpty, useSearchQuery } from '@/components/ui';
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

/** How many conversations have unread messages, for the empty pane beside the inbox. */
export const UnreadPeopleContext = createContext(0);

/** The conversation a wide screen opens instead of an empty pane: the latest, only when none shown is unread. */
export const FirstConversationContext = createContext<string | null>(null);

/**
 * The two panes: the inbox (current clients, latest message first) and, beside it, the open conversation (the
 * route's page). On a phone only one shows at a time. The server sends the rows; Realtime events and focus ask the
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
  // In the address (?q=), like the other searches: Back and a reload keep it.
  const { query, setQuery, debounced } = useSearchQuery({ urlParam: 'q' });
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

  const unreadCount = rows.filter((r) => r.unread > 0).length;
  const shown = useMemo(() => filterInbox(rows, { unreadOnly, query: debounced }), [rows, unreadOnly, debounced]);
  // A wide screen opens the latest conversation in the list shown (Unread filter and search applied), but only when
  // nothing there is unread: then the empty pane says how many are waiting and the coach picks.
  const firstConversation = shown.some((r) => r.unread > 0) ? null : (shown.find((r) => r.lastMessageAt !== null)?.clientId ?? null);

  return (
    <div className={styles.shell} data-screen={segment ? 'thread' : 'list'}>
      <section className={cx(styles.pane, styles.inboxPane)} aria-labelledby="inbox-heading">
        <div className={styles.inboxHead}>
          <div className={styles.filters}>
            <h1 id="inbox-heading" className={styles.heading}>Messages</h1>
            <button type="button" className={styles.toggle} aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
              Unread{unreadCount > 0 ? ` ${unreadCount}` : ''}
            </button>
          </div>
          <SearchBox label="Search clients" value={query} onChange={setQuery} />
        </div>
        {shown.length === 0 ? (
          // With Unread on, say "Nothing unread" when the search alone would find someone.
          rows.length > 0 && debounced.trim() !== '' && (!unreadOnly || filterInbox(rows, { unreadOnly: false, query: debounced }).length === 0) ? (
            <SearchEmpty things="clients" query={debounced} onClear={() => setQuery('')} className={styles.empty} />
          ) : (
            <p className={styles.empty}>{rows.length === 0 ? 'No clients yet. Invite one from Clients.' : 'Nothing unread.'}</p>
          )
        ) : (
          <RowList aria-label="Conversations" className={styles.list}>
            {shown.map((r) => (
              <ListRow
                key={r.clientId}
                href={`/messages/${r.clientId}`}
                current={segment === r.clientId}
                emphasis={r.unread > 0}
                className={styles.row}
                leading={
                  <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(r.clientId)}`])}>
                    {initials(r.name)}
                  </span>
                }
                title={r.name}
                meta={<span className={styles.preview}>{r.preview ? `${r.lastFromMe ? 'You: ' : ''}${r.preview}` : 'No messages yet'}</span>}
                end={
                  <>
                    {r.lastMessageAt ? <RowTime iso={r.lastMessageAt} now={now} /> : null}
                    {r.unread > 0 ? (
                      <span className={styles.count}>
                        {badgeText(r.unread)}
                        <span className={styles.srOnly}> unread</span>
                      </span>
                    ) : null}
                  </>
                }
                linkProps={{ 'data-unread': r.unread }}
              />
            ))}
          </RowList>
        )}
      </section>
      <section className={cx(styles.pane, styles.threadPane)} aria-label="Conversation">
        <UnreadPeopleContext.Provider value={unreadCount}>
          <FirstConversationContext.Provider value={firstConversation}>{children}</FirstConversationContext.Provider>
        </UnreadPeopleContext.Provider>
      </section>
    </div>
  );
}
