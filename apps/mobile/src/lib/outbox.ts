// Messages written on the phone, kept until the server has them. Same shape as the workout-log sync: the phone's
// copy is the source of truth until the send succeeds, a missing signal retries with backoff (5 s, 15 s, 60 s,
// then 300 s), and everything survives a restart because it lives in AsyncStorage (injected, so tests use a map).
//
// Why a repeat is safe: every entry has a client_msg_id made on the phone, and the database refuses a second
// message with the same (sender, client_msg_id). The sender treats that refusal as success and re-selects the row,
// so an app that died before it heard back sends once, not twice. A photo uploaded twice (409) also counts as sent.
//
// States: 'sending' (shown "Sending…") retries on its own. 'failed' (shown "Didn't send · Retry") waits for the
// person to tap Retry: a photo that would not upload, or a send the server refused.
import type { PhotoExt } from '@caltracker/shared';
import { RETRY_BACKOFF_MS } from './log-sync';
import type { KeyValueStorage } from './log-store';

export const OUTBOX_BACKOFF_MS = RETRY_BACKOFF_MS;

/** A photo already shrunk on the device (1600 px long edge) with its thumbnail, as local files. */
export type OutboxPhoto = { id: string; fullUri: string; thumbUri: string; ext: PhotoExt };

export type OutboxEntry = {
  clientMsgId: string;
  conversationId: string;
  body: string;
  createdAt: string;
  photos: OutboxPhoto[];
  state: 'sending' | 'failed';
  error?: string | undefined;
};

export type SendFailure = 'network' | 'photo' | 'refused';

/** What a send throws: no signal (try again later), a photo that would not upload, or a refusal (try only on request). */
export class OutboxSendError extends Error {
  constructor(
    readonly kind: SendFailure,
    message: string,
  ) {
    super(message);
    this.name = 'OutboxSendError';
  }
}

export const outboxKey = (userId: string) => `caltracker.messageOutbox.${userId}`;

export type Outbox = {
  load(): Promise<OutboxEntry[]>;
  items(): OutboxEntry[];
  enqueue(entry: OutboxEntry): Promise<void>;
  /** Sends what is waiting, oldest first. Stops at the first missing signal and schedules a retry. */
  flush(): Promise<void>;
  /** "Retry" on a failed message. */
  retry(clientMsgId: string): Promise<void>;
  /** "Delete" on a failed message: it will never be sent (also the way out of a permanent refusal). */
  remove(clientMsgId: string): Promise<void>;
  stop(): void;
};

export type OutboxDeps = {
  storage: KeyValueStorage;
  userId: string;
  /** Uploads the photos and inserts the message. Throws OutboxSendError. Resolves once the server has it. */
  send: (entry: OutboxEntry) => Promise<void>;
  /** Called after every change to the list (for the screen). */
  onChange?: (items: OutboxEntry[]) => void;
  /** Called once an entry is on the server. */
  onSent?: (entry: OutboxEntry) => void;
  /** Called when a failed entry is deleted by the person. */
  onRemoved?: (entry: OutboxEntry) => void;
  schedule?: (fn: () => void, ms: number) => () => void;
};

function parse(raw: string | null): OutboxEntry[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (e): e is OutboxEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as OutboxEntry).clientMsgId === 'string' &&
        typeof (e as OutboxEntry).conversationId === 'string' &&
        typeof (e as OutboxEntry).body === 'string' &&
        typeof (e as OutboxEntry).createdAt === 'string' &&
        Array.isArray((e as OutboxEntry).photos) &&
        ((e as OutboxEntry).state === 'sending' || (e as OutboxEntry).state === 'failed'),
    );
  } catch {
    return [];
  }
}

export function createOutbox(deps: OutboxDeps): Outbox {
  const { storage, userId, send } = deps;
  const key = outboxKey(userId);
  const schedule = deps.schedule ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  let list: OutboxEntry[] = [];
  let loaded = false;
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let failures = 0;
  let cancelTimer: (() => void) | null = null;

  async function persist(next: OutboxEntry[]): Promise<void> {
    list = next;
    deps.onChange?.(list);
    await storage.setItem(key, JSON.stringify(list));
  }

  const patch = (id: string, change: Partial<OutboxEntry>) =>
    persist(list.map((e) => (e.clientMsgId === id ? { ...e, ...change } : e)));

  async function load(): Promise<OutboxEntry[]> {
    list = parse(await storage.getItem(key));
    loaded = true;
    deps.onChange?.(list);
    return list;
  }

  function armRetry() {
    cancelTimer?.();
    const ms = OUTBOX_BACKOFF_MS[Math.min(failures, OUTBOX_BACKOFF_MS.length - 1)];
    failures += 1;
    cancelTimer = schedule(() => {
      cancelTimer = null;
      void flush();
    }, ms);
  }

  async function run(): Promise<void> {
    if (!loaded) await load();
    for (;;) {
      if (stopped) return;
      const next = list.find((e) => e.state === 'sending');
      if (!next) {
        failures = 0;
        return;
      }
      try {
        await send(next);
      } catch (e) {
        if (stopped) return;
        const kind: SendFailure = e instanceof OutboxSendError ? e.kind : 'refused';
        if (kind === 'network') {
          armRetry();
          return;
        }
        const message = e instanceof Error ? e.message : "Couldn't send. Please try again.";
        await patch(next.clientMsgId, { state: 'failed', error: message });
        continue;
      }
      if (stopped) return;
      failures = 0;
      cancelTimer?.();
      cancelTimer = null;
      await persist(list.filter((e) => e.clientMsgId !== next.clientMsgId));
      deps.onSent?.(next);
    }
  }

  function flush(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await run();
        } while (again && !stopped);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    load,
    items: () => list,
    async enqueue(entry) {
      if (!loaded) await load();
      if (list.some((e) => e.clientMsgId === entry.clientMsgId)) return;
      await persist([...list, entry]);
    },
    flush,
    async retry(id) {
      if (!loaded) await load();
      const target = list.find((e) => e.clientMsgId === id);
      if (!target || target.state !== 'failed') return;
      await patch(id, { state: 'sending', error: undefined });
      await flush();
    },
    async remove(id) {
      if (!loaded) await load();
      const target = list.find((e) => e.clientMsgId === id);
      // Only a failed message can be deleted: one that is Sending… is still on its way.
      if (!target || target.state !== 'failed') return;
      await persist(list.filter((e) => e.clientMsgId !== id));
      deps.onRemoved?.(target);
    },
    stop() {
      stopped = true;
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}
