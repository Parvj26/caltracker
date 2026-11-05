// Background upload of the active workout log ("offline-lite": no PowerSync).
// The phone's copy in the log store is the source of truth while training. The screen writes each change to the
// store and calls push(); this module sends the whole doc to save_workout_log a second later, retries with
// backoff while there is no signal, and survives restarts because everything it needs is in the store.
// The app should call push() (or flushNow()) on start and whenever it comes back to the foreground.
//
// Server contract (global-constraints "SYNC SEMANTICS"): save returns { applied, revision, status }, and
// revision is the phone's own counter that the server never changes.
//   * applied=true: the sent revision is now on the server. If the phone changed the log meanwhile, send again.
//   * applied=false: the server refused (stale or locked). Fetch its doc and let resolveRefusal decide.
import { autoFinish, shouldAutoFinish, type LogStatus, type WorkoutLogDoc } from '@caltracker/shared';
import type { LogStore, StoredLog } from './log-store';

export const SYNC_DEBOUNCE_MS = 1000;
/** Wait before each retry: 5 s, 15 s, 60 s, then 300 s steady. */
export const RETRY_BACKOFF_MS = [5000, 15000, 60000, 300000] as const;
/** Saves in one flush before giving up to the backoff, so a server that keeps refusing never causes a tight loop. */
const MAX_ROUNDS = 5;
/** Consecutive network failures after which the status reads "offline" rather than "pending". */
const OFFLINE_AFTER_FAILURES = 2;

export type SaveLogResult = { applied: boolean; revision: number; status: LogStatus };
export type SyncStatus = 'synced' | 'pending' | 'offline';
/** `adopted` is the server's doc when the phone replaced its own copy with it, so the screen can show it. */
export type SyncResult = { status: SyncStatus; adopted: WorkoutLogDoc | null };

export type LogSyncDeps = {
  save: (doc: WorkoutLogDoc) => Promise<SaveLogResult>;
  fetchLog: (id: string) => Promise<WorkoutLogDoc | null>;
  store: LogStore;
  now?: () => number;
  /** Runs fn after ms and returns a cancel function. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
};

export type LogSync = {
  push(): void;
  flushNow(): Promise<SyncResult>;
  status(): SyncStatus;
};

export type RefusalResolution = { kind: 'push' } | { kind: 'adopt'; stored: StoredLog } | { kind: 'retry' };

/**
 * What to do after the server refused a save. Pure.
 *   * push: the server still has the log in progress at an older revision (a duplicate save whose answer was
 *     lost), so the phone's newer copy should be sent again.
 *   * adopt: anything else. The log is locked (a coach correction, a manual finish elsewhere, the 24 h limit)
 *     or the server already has this revision, so the phone takes the server's doc.
 *   * retry: the server's doc could not be read; keep the phone's copy and try again later.
 */
export function resolveRefusal(local: WorkoutLogDoc, server: WorkoutLogDoc | null): RefusalResolution {
  if (server === null) return { kind: 'retry' };
  if (server.status === 'in_progress' && local.revision > server.revision) return { kind: 'push' };
  return { kind: 'adopt', stored: { log: server, lastSyncedRevision: server.revision } };
}

const isFinished = (log: WorkoutLogDoc) => log.status !== 'in_progress';
const isSynced = (s: StoredLog) => s.log.revision <= s.lastSyncedRevision;

function isNetworkError(e: unknown): boolean {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /network request failed|failed to fetch|network ?error|load failed|timed? ?out/i.test(text);
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function createLogSync(deps: LogSyncDeps): LogSync {
  const { save, fetchLog, store } = deps;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;

  let current: SyncStatus = 'synced';
  let failures = 0;
  let networkFailures = 0;
  let cancelDebounce: (() => void) | null = null;
  let cancelRetry: (() => void) | null = null;
  // Flushes run one after another, so only one save is ever in flight.
  let queue: Promise<unknown> = Promise.resolve();

  function scheduleRetry() {
    cancelRetry?.();
    const delay = RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length - 1)];
    failures += 1;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void flushNow();
    }, delay);
  }

  /** Loads the phone's copy, finishing a forgotten workout and dropping a finished one that is already saved. */
  async function prepare(): Promise<StoredLog | null> {
    const stored = await store.update((s) => {
      if (s === null) return null;
      if (shouldAutoFinish(s.log, now())) return { ...s, log: autoFinish(s.log) };
      if (isFinished(s.log) && isSynced(s)) return null;
      return s;
    });
    return stored;
  }

  async function run(): Promise<SyncResult> {
    cancelRetry?.();
    cancelRetry = null;
    let adopted: WorkoutLogDoc | null = null;
    const finish = (status: SyncStatus): SyncResult => {
      current = status;
      return { status, adopted };
    };

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const stored = await prepare();
        if (stored === null || isSynced(stored)) {
          failures = 0;
          networkFailures = 0;
          return finish('synced');
        }

        const sent = stored.log;
        const result = await save(sent);
        networkFailures = 0; // the server answered, so the phone is online

        if (result.applied) {
          failures = 0;
          await store.update((s) =>
            s && s.log.id === sent.id ? { ...s, lastSyncedRevision: Math.max(s.lastSyncedRevision, sent.revision) } : s,
          );
          continue; // sends again if the log changed during the save; clears it if finished
        }

        const server = await fetchLog(sent.id);
        // Decide against the phone's latest copy inside one store update, so an edit written meanwhile is
        // only replaced when the server's doc really wins.
        let decision: RefusalResolution | null = null;
        await store.update((s) => {
          if (s === null || s.log.id !== sent.id) return s; // the log is gone from the phone
          decision = resolveRefusal(s.log, server);
          return decision.kind === 'adopt' ? decision.stored : s;
        });
        const d = decision as RefusalResolution | null; // assigned inside the callback, which TS cannot see
        if (d?.kind === 'retry') {
          scheduleRetry();
          return finish('pending');
        }
        if (d?.kind === 'adopt') {
          adopted = d.stored.log;
          failures = 0;
        }
        // 'push', after adopting, or gone: go round again.
      }
      scheduleRetry();
      return finish('pending');
    } catch (e) {
      console.warn(`[log-sync] save failed: ${e instanceof Error ? e.message : String(e)}`);
      if (isNetworkError(e)) networkFailures += 1;
      scheduleRetry();
      return finish(networkFailures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'pending');
    }
  }

  function flushNow(): Promise<SyncResult> {
    cancelDebounce?.();
    cancelDebounce = null;
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    push() {
      if (current === 'synced') current = 'pending';
      cancelDebounce?.();
      cancelDebounce = schedule(() => {
        cancelDebounce = null;
        void flushNow();
      }, SYNC_DEBOUNCE_MS);
    },
    flushNow,
    status: () => current,
  };
}
