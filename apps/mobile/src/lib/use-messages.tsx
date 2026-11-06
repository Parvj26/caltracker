// The client's chat with their coach, for every screen: the Coach tab's thread and the unread badge on its icon.
//
// The server is the truth for sent messages; the on-device outbox (outbox.ts) is the truth for messages still on
// their way. Both are merged for display (mergeOutbox). Realtime pushes new messages and read marks while the app is
// open (no lock-screen push yet: that needs the paid Apple account). Whatever Realtime misses while the app was
// asleep is fetched again on joining the channel and on returning to the foreground.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { mergeById, mergeOutbox, seenMessageId, unreadCount, type Message, type OutboxItem } from '@caltracker/shared';
import {
  PAGE_SIZE,
  loadEarlier as fetchEarlier,
  loadMessages,
  loadReads,
  markRead as serverMarkRead,
  openConversation,
  sendEntry,
  subscribeChanges,
  toMessage,
  type MessageRowLite,
} from './messages-api';
import { createOutbox, type Outbox, type OutboxEntry, type OutboxPhoto } from './outbox';
import { deletePhotoFiles, persistPhoto } from './outbox-files';
import { shouldMarkRead } from './read-rules';
import { useSession } from './session';

export type ThreadItem = Message | OutboxItem;
export type Draft = { body: string; photos: OutboxPhoto[] };

type MessagesState = {
  /** 'offline' when the thread could not be read; messages written meanwhile still wait in the outbox. */
  status: 'loading' | 'ready' | 'offline';
  conversationId: string | null;
  me: string | null;
  items: ThreadItem[];
  /** Local file URIs of the photos of messages still on their way, by client_msg_id. */
  localPhotos: Record<string, string[]>;
  failedError: Record<string, string | undefined>;
  unread: number;
  seenId: string | null;
  hasMore: boolean;
  send: (draft: Draft) => void;
  retry: (clientMsgId: string) => void;
  /** Deletes a failed message (it will never be sent). */
  remove: (clientMsgId: string) => void;
  reload: () => void;
  loadEarlier: () => Promise<void>;
  /** The Coach tab reports whether it is on screen; the thread is marked read only while it is. */
  setViewing: (viewing: boolean) => void;
};

const MessagesContext = createContext<MessagesState | null>(null);
const conversationKey = (userId: string) => `caltracker.conversation.${userId}`;

export function MessagesProvider({ children }: { children: ReactNode }) {
  const { session, workspace } = useSession();
  const me = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  return me && workspaceId ? (
    <Loaded key={`${me}:${workspaceId}`} me={me} workspaceId={workspaceId}>
      {children}
    </Loaded>
  ) : (
    <MessagesContext.Provider value={null}>{children}</MessagesContext.Provider>
  );
}

function Loaded({ me, workspaceId, children }: { me: string; workspaceId: string; children: ReactNode }) {
  const [status, setStatus] = useState<MessagesState['status']>('loading');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [myReadAt, setMyReadAt] = useState<string | null>(null);
  const [theirReadAt, setTheirReadAt] = useState<string | null>(null);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [viewing, setViewing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const convRef = useRef<string | null>(null);
  const boxRef = useRef<Outbox | null>(null);
  const markingRef = useRef(false);

  const addMessages = useCallback((rows: Message[]) => setMessages((prev) => mergeById(prev, rows)), []);

  // The outbox belongs to this user for as long as the provider lives.
  useEffect(() => {
    const box = createOutbox({
      storage: AsyncStorage,
      userId: me,
      send: async (entry) => {
        const row = await sendEntry(entry, workspaceId);
        addMessages([toMessage(row)]);
      },
      onChange: setEntries,
      // The queued photo files go once the message is on the server or the person deleted it.
      onSent: (entry) => deletePhotoFiles(entry.photos),
      onRemoved: (entry) => deletePhotoFiles(entry.photos),
    });
    boxRef.current = box;
    void box.load().then(() => box.flush());
    return () => {
      box.stop();
      boxRef.current = null;
    };
  }, [me, workspaceId, addMessages]);

  /** Reads the latest page and both read marks. Never throws. */
  const refetch = useCallback(async (id: string): Promise<boolean> => {
    try {
      const [rows, reads] = await Promise.all([loadMessages(id), loadReads(id, me)]);
      setMessages((prev) => mergeById(prev, rows.map(toMessage)));
      setHasMore((prev) => prev || rows.length >= PAGE_SIZE);
      setMyReadAt((prev) => later(prev, reads.mine));
      setTheirReadAt((prev) => later(prev, reads.theirs));
      setStatus('ready');
      return true;
    } catch {
      return false;
    }
  }, [me]);

  // Find the conversation, then the thread.
  useEffect(() => {
    let alive = true;
    void (async () => {
      let id: string | null;
      try {
        id = await openConversation();
        if (id) await AsyncStorage.setItem(conversationKey(me), id).catch(() => undefined);
      } catch {
        // No signal: use the id saved on the phone so a message can still be written.
        id = await AsyncStorage.getItem(conversationKey(me)).catch(() => null);
      }
      if (!alive) return;
      convRef.current = id;
      setConversationId(id);
      if (!id) {
        setStatus('offline');
        return;
      }
      const ok = await refetch(id);
      if (alive && !ok) setStatus('offline');
    })();
    return () => {
      alive = false;
    };
  }, [me, attempt, refetch]);

  // Live updates. A fresh topic per join (see subscribeChanges).
  useEffect(() => {
    if (!conversationId) return;
    return subscribeChanges(
      `thread-${conversationId}`,
      [
        { table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        { table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` },
      ],
      {
        onChange: (table, row) => {
          if (table === 'messages' && typeof row.id === 'string') {
            addMessages([toMessage(row as unknown as MessageRowLite)]);
          } else if (table === 'conversation_reads' && typeof row.last_read_at === 'string') {
            const at = row.last_read_at;
            if (row.user_id === me) setMyReadAt((prev) => later(prev, at));
            else setTheirReadAt((prev) => later(prev, at));
          }
        },
        // Joined (or rejoined after a drop): catch up on what was missed and send what is waiting.
        onReady: () => {
          void refetch(conversationId);
          void boxRef.current?.flush();
        },
      },
    );
  }, [conversationId, me, addMessages, refetch]);

  // Back in the app: catch up and send what is waiting.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state !== 'active') return;
      void boxRef.current?.flush();
      if (convRef.current) void refetch(convRef.current);
    });
    return () => sub.remove();
  }, [refetch]);

  const latestFromCoach = useMemo(() => {
    let best: string | null = null;
    for (const m of messages) if (m.senderId !== me && (best === null || Date.parse(m.createdAt) > Date.parse(best))) best = m.createdAt;
    return best;
  }, [messages, me]);

  // Mark read only while the Coach tab is on screen AND the app is in the foreground (never from a locked phone).
  useEffect(() => {
    if (markingRef.current) return;
    if (!shouldMarkRead({ viewing, appActive, conversationId, latestFromCoach, myReadAt }) || !conversationId || latestFromCoach === null) return;
    markingRef.current = true;
    serverMarkRead(conversationId)
      .then(() => setMyReadAt((prev) => later(prev, latestFromCoach)))
      .catch(() => undefined)
      .finally(() => {
        markingRef.current = false;
      });
  }, [viewing, appActive, conversationId, latestFromCoach, myReadAt]);

  const send = useCallback(
    (draft: Draft) => {
      const id = convRef.current;
      const box = boxRef.current;
      if (!id || !box) return;
      const clientMsgId = randomUUID();
      const createdAt = new Date().toISOString();
      void (async () => {
        // Move the photos out of the cache so they survive until there is signal.
        let queued = draft.photos;
        try {
          queued = await Promise.all(draft.photos.map(persistPhoto));
        } catch {
          // keep the cache copies: better than not sending
        }
        await box.enqueue({
          clientMsgId,
          conversationId: id,
          body: draft.body.trim(),
          createdAt,
          photos: queued,
          state: 'sending',
        });
        await box.flush();
      })();
    },
    [],
  );
  const retry = useCallback((clientMsgId: string) => void boxRef.current?.retry(clientMsgId), []);
  const remove = useCallback((clientMsgId: string) => void boxRef.current?.remove(clientMsgId), []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const loadEarlier = useCallback(async () => {
    const id = convRef.current;
    const oldest = messages[0];
    if (!id || !oldest) return;
    const rows = await fetchEarlier(id, oldest.createdAt);
    addMessages(rows.map(toMessage));
    if (rows.length < PAGE_SIZE) setHasMore(false);
  }, [messages, addMessages]);

  const value = useMemo<MessagesState>(() => {
    const outbox: OutboxItem[] = entries.map((e) => ({
      clientMsgId: e.clientMsgId,
      body: e.body,
      imagePaths: e.photos.map((p) => p.thumbUri),
      createdAt: e.createdAt,
      state: e.state,
    }));
    return {
      status,
      conversationId,
      me,
      items: mergeOutbox(messages, outbox),
      localPhotos: Object.fromEntries(entries.map((e) => [e.clientMsgId, e.photos.map((p) => p.thumbUri)])),
      failedError: Object.fromEntries(entries.map((e) => [e.clientMsgId, e.error])),
      unread: unreadCount(messages, me, myReadAt),
      seenId: seenMessageId(messages, me, theirReadAt),
      hasMore,
      send,
      retry,
      remove,
      reload,
      loadEarlier,
      setViewing,
    };
  }, [status, conversationId, me, messages, entries, myReadAt, theirReadAt, hasMore, send, retry, remove, reload, loadEarlier]);

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Null while there is no coach (the Coach tab does not exist then). */
export function useMessages(): MessagesState | null {
  return useContext(MessagesContext);
}

/** Unread count for the tab badge (0 when unknown). */
export function useUnreadCount(): number {
  return useContext(MessagesContext)?.unread ?? 0;
}
