// The active workout log, kept on the phone so closing the app or the phone dying never loses a ticked set.
// One log per signed-in user, as JSON in AsyncStorage (injected, so tests use an in-memory map).
// lastSyncedRevision is the highest revision the server has accepted; anything above it still needs sending.
import { WorkoutLogDoc } from '@caltracker/shared';

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
};

function parseStored(value: unknown): StoredLog | null {
  if (typeof value !== 'object' || value === null) return null;
  const { log, lastSyncedRevision } = value as { log?: unknown; lastSyncedRevision?: unknown };
  if (typeof lastSyncedRevision !== 'number' || !Number.isInteger(lastSyncedRevision) || lastSyncedRevision < 0) return null;
  const parsed = WorkoutLogDoc.safeParse(log);
  return parsed.success ? { log: parsed.data, lastSyncedRevision } : null;
}

export const logStoreKey = (userId: string) => `caltracker.activeLog.${userId}`;

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
    console.warn('[log-store] the stored workout could not be read; removing it');
    await storage.removeItem(key);
    return null;
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
  };
}
