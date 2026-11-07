'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayLabel, isAlreadyUploaded, mergeById, mergeOutbox, messageYoutubeIds, photoPaths, seenMessageId, thumbPathOf, type PhotoExt } from '@caltracker/shared';
import type { Message, OutboxItem } from '@caltracker/shared';
import { SharpPhoto } from '@/components/sharp-photo';
import { cx } from '@/components/ui/cx';
import { failureMessage } from '@/lib/action-errors';
import { PhotoError, compressPhoto } from '@/lib/image-resize';
import { avatarTone, initials } from '../clients/avatar';
import { markRead, sendMessage } from './actions';
import { Composer, type Draft } from './composer';
import { PAGE_SIZE, loadMessages, loadTheirRead, toMessage, type MessageRow } from './data';
import { clockTime, useNow, useTimeZone } from './time';
import { useBrowserSupabase, useChanges, useOnWake } from './use-realtime';
import styles from './messages.module.css';

const BUCKET = 'message-images';
const SIGNED_URL_SECONDS = 3600;
const RESIGN_AFTER_MS = 50 * 60 * 1000;
const GENERIC_FAILURE = "Couldn't send. Please try again.";

type Pending = OutboxItem & { photoIds: string[]; files: File[]; previews: string[]; error?: string | undefined };
type Compressed = { full: Blob; thumb: Blob; ext: PhotoExt };

class SendError extends Error {}

type Props = {
  conversationId: string | null;
  workspaceId: string;
  me: string;
  clientId: string;
  clientName: string;
  /** Latest messages, newest first (as the database returns them). */
  rows: MessageRow[];
  theirReadAt: string | null;
  /** A past client: history only, nothing is marked read and nothing can be sent. */
  readOnly: boolean;
  /** Shown inside another page (no header, fixed height). */
  embedded?: boolean;
  /** Text to start the reply box with (e.g. "About your Lunch on Tue 3 Nov (12:15 pm): " from the Food tab). */
  initialBody?: string | undefined;
};

/** Short-lived signed URLs for private photos, renewed before they run out and when the window wakes up. */
function useSignedUrls(paths: string[], tick: number): Record<string, string> {
  const supabase = useBrowserSupabase();
  const [signed, setSigned] = useState<Record<string, { url: string; at: number }>>({});
  const ref = useRef(signed);
  useEffect(() => {
    ref.current = signed;
  });
  const key = paths.join('|');
  useEffect(() => {
    const wanted = key ? key.split('|') : [];
    const stale = wanted.filter((p) => {
      const have = ref.current[p];
      return !have || Date.now() - have.at > RESIGN_AFTER_MS;
    });
    if (stale.length === 0) return;
    let cancelled = false;
    void supabase.storage
      .from(BUCKET)
      .createSignedUrls(stale, SIGNED_URL_SECONDS)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const at = Date.now();
        setSigned((prev) => {
          const next = { ...prev };
          for (const item of data) if (item.path && item.signedUrl) next[item.path] = { url: item.signedUrl, at };
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, key, tick]);
  return useMemo(() => Object.fromEntries(Object.entries(signed).map(([p, v]) => [p, v.url])), [signed]);
}

function Bubble({
  item,
  mine,
  seen,
  urls,
  timeZone,
  onRetry,
}: {
  item: Message | Pending;
  mine: boolean;
  seen: boolean;
  urls: Record<string, string>;
  timeZone: string;
  onRetry: (p: Pending) => void;
}) {
  const pending = 'state' in item ? item : null;
  const youtube = messageYoutubeIds(item.body);
  // A message on its way shows the local files; a sent one shows the full photo, its thumbnail as the placeholder.
  const photos = pending
    ? pending.previews.map((src) => ({ full: src, thumb: undefined }))
    : item.imagePaths.map((p) => ({ full: urls[p], thumb: urls[thumbPathOf(p)] }));
  return (
    <div className={cx(styles.item, mine ? styles.itemMine : styles.itemTheirs)} data-message={pending ? 'pending' : 'sent'}>
      <div className={cx(styles.bubble, pending?.state === 'failed' && styles.bubbleFailed)}>
        {photos.length > 0 ? (
          <div className={styles.photos}>
            {photos.map((p, i) => (
              <a key={i} className={styles.photo} href={p.full} target="_blank" rel="noreferrer" aria-label={`Open photo ${i + 1}`}>
                {p.full ? <SharpPhoto full={p.full} thumb={p.thumb} alt={`Photo ${i + 1}`} maxHeight="360px" /> : null}
              </a>
            ))}
          </div>
        ) : null}
        {item.body ? <p className={styles.text}>{item.body}</p> : null}
        {youtube.map((id) => (
          <a key={id} className={styles.youtube} href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's public thumbnail */}
            <img src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
            <span>Watch on YouTube</span>
          </a>
        ))}
      </div>
      <div className={styles.meta}>
        {pending ? (
          pending.state === 'sending' ? (
            <span>Sending…</span>
          ) : (
            <>
              <span>Didn&apos;t send ·</span>
              <button type="button" className={styles.retry} onClick={() => onRetry(pending)}>Retry</button>
            </>
          )
        ) : (
          <time dateTime={item.createdAt}>{clockTime(item.createdAt, timeZone)}</time>
        )}
        {seen ? <span>Seen</span> : null}
      </div>
      {pending?.state === 'failed' && pending.error ? <p role="alert" className={styles.error}>{pending.error}</p> : null}
    </div>
  );
}

export function Conversation({ conversationId, workspaceId, me, clientId, clientName, rows, theirReadAt: initialRead, readOnly, embedded = false, initialBody }: Props) {
  const supabase = useBrowserSupabase();
  const timeZone = useTimeZone();
  const [now, refreshNow] = useNow();
  const [messages, setMessages] = useState<Message[]>(() => mergeById([], rows.map(toMessage)));
  const [hasMore, setHasMore] = useState(rows.length >= PAGE_SIZE);
  const [theirReadAt, setTheirReadAt] = useState(initialRead);
  const [pending, setPending] = useState<Pending[]>([]);
  const [tick, setTick] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  // Fresh data from the server (after a router refresh) joins the local copy; it never wipes live messages.
  const [shownRows, setShownRows] = useState(rows);
  if (shownRows !== rows) {
    setShownRows(rows);
    setMessages((prev) => mergeById(prev, rows.map(toMessage)));
    setTheirReadAt((prev) => (initialRead && (!prev || Date.parse(initialRead) > Date.parse(prev)) ? initialRead : prev));
  }

  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const heightBefore = useRef<number | null>(null);
  const compressed = useRef(new Map<string, Compressed[]>());
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  useEffect(
    () => () => {
      for (const p of pendingRef.current) p.previews.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const markIfVisible = useCallback(() => {
    if (readOnly || !conversationId || document.visibilityState !== 'visible') return;
    markRead(conversationId).catch(() => {
      // The next message, focus or visit marks it again.
    });
  }, [readOnly, conversationId]);
  useEffect(() => {
    markIfVisible();
  }, [markIfVisible]);

  /** Catches up on anything Realtime missed (a sleeping laptop, a dropped connection). */
  const refetch = useCallback(() => {
    if (!conversationId) return;
    Promise.all([loadMessages(supabase, conversationId), loadTheirRead(supabase, conversationId, clientId)]).then(
      ([latest, read]) => {
        setMessages((prev) => mergeById(prev, latest.map(toMessage)));
        setTheirReadAt((prev) => (read && (!prev || Date.parse(read) > Date.parse(prev)) ? read : prev));
        markIfVisible();
      },
      () => {
        // Offline for now: the next focus or reconnect tries again.
      },
    );
  }, [supabase, conversationId, clientId, markIfVisible]);

  useChanges(
    supabase,
    `thread-${conversationId ?? 'none'}`,
    conversationId
      ? [
          { table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          { table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` },
        ]
      : [],
    {
      onChange: (table, row) => {
        if (table === 'messages' && typeof row.id === 'string') {
          const m = toMessage(row as unknown as MessageRow);
          setMessages((prev) => mergeById(prev, [m]));
          if (m.senderId !== me) markIfVisible();
        } else if (table === 'conversation_reads' && row.user_id !== me && typeof row.last_read_at === 'string') {
          const at = row.last_read_at;
          setTheirReadAt((prev) => (!prev || Date.parse(at) > Date.parse(prev) ? at : prev));
        }
      },
      onReady: refetch,
    },
  );
  useOnWake(() => {
    refreshNow();
    setTick((t) => t + 1);
    refetch();
  });

  const items = useMemo(() => {
    const outbox: OutboxItem[] = pending.map(({ clientMsgId, body, imagePaths, createdAt, state }) => ({ clientMsgId, body, imagePaths, createdAt, state }));
    return mergeOutbox(messages, outbox);
  }, [messages, pending]);
  const pendingById = useMemo(() => new Map(pending.map((p) => [p.clientMsgId, p])), [pending]);
  const seenId = useMemo(() => seenMessageId(messages, me, theirReadAt), [messages, me, theirReadAt]);

  const allPaths = useMemo(() => {
    const out = new Set<string>();
    for (const m of messages) for (const p of m.imagePaths) out.add(p).add(thumbPathOf(p));
    return [...out];
  }, [messages]);
  const urls = useSignedUrls(allPaths, tick);

  // Stay at the bottom for new messages unless the coach scrolled up; keep the place after loading earlier ones.
  const lastKey = items.at(-1)?.clientMsgId;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (heightBefore.current !== null) {
      el.scrollTop += el.scrollHeight - heightBefore.current;
      heightBefore.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastKey, items.length, pending.length]);

  async function loadEarlier() {
    if (!conversationId || messages.length === 0) return;
    setLoadingEarlier(true);
    try {
      const older = await loadMessages(supabase, conversationId, messages[0]!.createdAt);
      heightBefore.current = listRef.current?.scrollHeight ?? null;
      stick.current = false;
      setMessages((prev) => mergeById(prev, older.map(toMessage)));
      if (older.length < PAGE_SIZE) setHasMore(false);
    } catch {
      // Stays as it was; the button is still there to try again.
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function deliver(p: Pending) {
    if (!conversationId) return;
    setPending((prev) => prev.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, state: 'sending', error: undefined } : x)));
    try {
      let imagePaths: string[] = [];
      if (p.files.length > 0) {
        let blobs = compressed.current.get(p.clientMsgId);
        if (!blobs) {
          blobs = await Promise.all(p.files.map((f) => compressPhoto(f)));
          compressed.current.set(p.clientMsgId, blobs);
        }
        // The extension depends on what the browser could encode, so the paths are known only now.
        imagePaths = [];
        for (const [i, b] of blobs.entries()) {
          const paths = photoPaths(workspaceId, conversationId, p.photoIds[i]!, b.ext);
          imagePaths.push(paths.full);
          const type = b.full.type;
          for (const [path, blob] of [[paths.full, b.full], [paths.thumb, b.thumb]] as const) {
            const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
            // A retry finds the photo already there: that is a success.
            if (error && !isAlreadyUploaded(error)) throw new SendError("Couldn't upload the photo. Please try again.");
          }
        }
      }
      const out = await sendMessage({
        conversation_id: conversationId,
        body: p.body,
        image_paths: imagePaths,
        client_msg_id: p.clientMsgId,
      });
      if (!out.ok) throw new SendError(out.error);
      setMessages((prev) => mergeById(prev, [toMessage(out.message)]));
      compressed.current.delete(p.clientMsgId);
      setPending((prev) => prev.filter((x) => x.clientMsgId !== p.clientMsgId));
      p.previews.forEach((u) => URL.revokeObjectURL(u));
    } catch (e) {
      const error = e instanceof SendError || e instanceof PhotoError ? e.message : failureMessage(e, GENERIC_FAILURE);
      setPending((prev) => prev.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, state: 'failed', error } : x)));
    }
  }

  function send(draft: Draft) {
    if (!conversationId) return;
    const photoIds = draft.files.map(() => crypto.randomUUID());
    const p: Pending = {
      clientMsgId: crypto.randomUUID(),
      body: draft.body.trim(),
      imagePaths: photoIds.map((id) => photoPaths(workspaceId, conversationId, id).full),
      createdAt: new Date().toISOString(),
      state: 'sending',
      photoIds,
      files: draft.files,
      previews: draft.files.map((f) => URL.createObjectURL(f)),
    };
    stick.current = true;
    setPending((prev) => [...prev, p]);
    void deliver(p);
  }

  // Day dividers between messages of different days.
  const body: React.ReactNode[] = [];
  let lastDay = '';
  for (const item of items) {
    const label = dayLabel(item.createdAt, now, timeZone);
    if (label !== lastDay) {
      body.push(<div key={`day-${item.createdAt}`} className={styles.day}>{label}</div>);
      lastDay = label;
    }
    const p = pendingById.get(item.clientMsgId);
    const stored = 'id' in item ? item : null;
    // A pending item whose server copy has arrived is already merged away; `stored` is the one to show then.
    const shown: Message | Pending | undefined = stored ?? p;
    if (!shown) continue;
    body.push(
      <Bubble
        key={item.clientMsgId}
        item={shown}
        mine={stored ? stored.senderId === me : true}
        seen={stored !== null && stored.id === seenId}
        urls={urls}
        timeZone={timeZone}
        onRetry={(x) => void deliver(x)}
      />,
    );
  }

  return (
    <>
      {embedded ? null : (
        <header className={styles.threadHead}>
          <Link href="/messages" className={styles.back} aria-label="Back to all conversations">← Back</Link>
          <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(clientId)}`])}>{initials(clientName)}</span>
          <div>
            <h2 className={styles.threadTitle}>{clientName}</h2>
            {readOnly ? <p className={styles.threadSub}>Past client · read-only history</p> : null}
          </div>
          <Link href={readOnly ? `/clients/${clientId}` : `/clients/${clientId}/training`} className={styles.threadLink}>{readOnly ? 'Client page' : 'Calendar'}</Link>
        </header>
      )}
      <div
        ref={listRef}
        className={styles.messages}
        role="log"
        aria-label={`Conversation with ${clientName}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {hasMore ? (
          <button type="button" className={styles.more} onClick={() => void loadEarlier()} disabled={loadingEarlier}>
            Show earlier messages
          </button>
        ) : null}
        {items.length === 0 ? (
          <p className={styles.placeholder}>
            {readOnly ? 'There are no messages in this history.' : `No messages yet. Say hello to ${clientName.split(' ')[0]}.`}
          </p>
        ) : (
          body
        )}
      </div>
      {readOnly || !conversationId ? (
        <p className={styles.readOnlyNote}>
          {readOnly ? "This client has been removed, so you can read the history but can't send new messages." : 'This conversation is not available.'}
        </p>
      ) : (
        <Composer onSend={send} initialBody={initialBody} />
      )}
    </>
  );
}
