// The active workout log, kept on the phone so closing the app or the phone dying never loses a ticked set.
// One active log per signed-in user, as JSON in AsyncStorage (injected, so tests use an in-memory map).
// lastSyncedRevision is the highest revision the server has accepted; anything above it still needs sending.
//
// Beside the active log, under the same key plus a suffix:
//   * .pending: finished logs still waiting to upload, moved out of the active slot by park() so a new workout
//     can start with no signal. The sync sends them before the active log. Never edited again.
//   * .rejected: the phone's copy of the latest log the server refused for good (a coach correction, a finish
//     on another device, the client removed), kept so support can recover its sets. Latest only.
//   * .corrupt: a stored value this version of the app could not read, kept instead of deleted.
import { parseWorkoutLogDocLenient, type WorkoutLogDoc } from '@caltracker/shared';

export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type StoredLog = { log: WorkoutLogDoc; lastSyncedRevision: number };

export type LogStore = {
  load(): Promise<StoredLog | null>;
  save(s: StoredLog): Promise<void>;
  clear(): Promise<void>;
  /** Read, change and write back as one step, so the screen and the background sync never overwrite each other. */
  update(change: (s: StoredLog | null) => StoredLog | null): Promise<StoredLog | null>;
  /** Finished logs waiting to upload, oldest first. */
  loadPending(): Promise<StoredLog[]>;
  /** Takes a log out of the pending list (it has uploaded, or the server refused it for good). */
  removePending(logId: string): Promise<void>;
  /**
   * Frees the active slot for a new workout: a finished log still waiting to upload moves to the pending list,
   * and a discarded one the server has never seen is dropped (there is nothing to send). Anything else stays.
   * Returns what the active slot holds afterwards.
   */
  park(): Promise<StoredLog | null>;
  /** Keeps the phone's copy of a log the server refused for good (latest only). */
  keepRejected(log: WorkoutLogDoc): Promise<void>;
};

/** What park() does with the active log. Pure. */
export function parkAction(s: StoredLog | null): 'keep' | 'drop' | 'park' {
  if (s === null || s.log.status === 'in_progress' || s.log.revision <= s.lastSyncedRevision) return 'keep';
  return s.log.status === 'discarded' && s.lastSyncedRevision === 0 ? 'drop' : 'park';
}

function parseStored(value: unknown): StoredLog | null {
  if (typeof value !== 'object' || value === null) return null;
  const { log, lastSyncedRevision } = value as { log?: unknown; lastSyncedRevision?: unknown };
  if (typeof lastSyncedRevision !== 'number' || !Number.isInteger(lastSyncedRevision) || lastSyncedRevision < 0) return null;
  const parsed = parseWorkoutLogDocLenient(log);
  return parsed.success ? { log: parsed.data, lastSyncedRevision } : null;
}

export const logStoreKey = (userId: string) => `caltracker.activeLog.${userId}`;

function parsePending(raw: string | null): StoredLog[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.map(parseStored).filter((s): s is StoredLog => s !== null);
  } catch {
    return [];
  }
}

export function createLogStore(storage: KeyValueStorage, userId: string): LogStore {
  const key = logStoreKey(userId);
  // Every operation runs after the previous one finishes, so a read-change-write is never interleaved.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op, op);
    queue = next.catch(() => undefined);
    return next;
  };

  async function read(): Promise<StoredLog | null> {
    const raw = await storage.getItem(key);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const stored = parseStored(parsed);
    if (stored) return stored;
    // Kept, not deleted: a future app version may read it, and support can recover its sets.
    console.warn('[log-store] the stored workout could not be read; keeping it aside');
    await storage.setItem(`${key}.corrupt`, raw);
    await storage.removeItem(key);
    return null;
  }

  const pendingKey = `${key}.pending`;
  const readPending = async () => parsePending(await storage.getItem(pendingKey));
  async function writePending(list: StoredLog[]): Promise<void> {
    if (list.length === 0) await storage.removeItem(pendingKey);
    else await storage.setItem(pendingKey, JSON.stringify(list));
  }

  async function write(s: StoredLog | null): Promise<void> {
    if (s === null) await storage.removeItem(key);
    else await storage.setItem(key, JSON.stringify(s));
  }

  return {
    load: () => serial(read),
    save: (s) => serial(() => write(s)),
    clear: () => serial(() => write(null)),
    update: (change) =>
      serial(async () => {
        const next = change(await read());
        await write(next);
        return next;
      }),
    loadPending: () => serial(readPending),
    removePending: (logId) =>
      serial(async () => {
        const list = await readPending();
        const next = list.filter((p) => p.log.id !== logId);
        if (next.length !== list.length) await writePending(next);
      }),
    park: () =>
      serial(async () => {
        const s = await read();
        const action = parkAction(s);
        if (action === 'keep' || s === null) return s;
        if (action === 'park') {
          // The pending list is written first: if the app dies in between, the log is in both places, and the
          // second upload of the same revision is simply refused as already there. It is never in neither.
          const list = (await readPending()).filter((p) => p.log.id !== s.log.id);
          await writePending([...list, s]);
        }
        await write(null);
        return null;
      }),
    keepRejected: (log) =>
      serial(() => storage.setItem(`${key}.rejected`, JSON.stringify({ log, keptAt: new Date().toISOString() }))),
  };
}

/**
 * Makes one edit to the stored log. The edit is always built from the stored doc (never from screen state)
 * with an op from packages/shared, so a server doc adopted meanwhile is edited rather than overwritten, and the
 * revision always rises above the stored one so the sync sends it. Returns the new stored log, or null when
 * no log is stored (the edit is then dropped). Call push() on the sync afterwards.
 */
export function applyEdit(store: LogStore, op: (log: WorkoutLogDoc) => WorkoutLogDoc): Promise<StoredLog | null> {
  return store.update((s) => {
    if (s === null) return null;
    const next = op(s.log);
    if (next === s.log) return s;
    return { ...s, log: next.revision > s.log.revision ? next : { ...next, revision: s.log.revision + 1 } };
  });
}

/**
 * applyEdit for the logging screen's own edits (tick, add a set, ...): refused unless the stored log is still in
 * progress, so an edit that lands just after an automatic finish or an adopted server copy never changes a
 * finished log. Finishing, discarding and reopening use applyEdit with their own shared ops.
 */
export function applyLiveEdit(store: LogStore, op: (log: WorkoutLogDoc) => WorkoutLogDoc): Promise<StoredLog | null> {
  return applyEdit(store, (log) => (log.status === 'in_progress' ? op(log) : log));
}
