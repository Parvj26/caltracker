// Background upload of the active workout log ("offline-lite": no PowerSync).
// The phone's copy in the log store is the source of truth while training. The screen makes every change with
// applyEdit (log-store.ts), which builds it from the stored doc, never from React state, and then calls push().
// This module sends the whole doc to save_workout_log a second later, retries with backoff while there is no
// signal, and survives restarts because everything it needs is in the store.
// The app should call push() (or flushNow()) on start and whenever it comes back to the foreground, show the doc
// passed to onAdopt whenever the server's copy replaces the phone's, and call stop() on sign-out or a user change.
//
// Server contract (global-constraints "SYNC SEMANTICS"): save returns { applied, revision, status }, and
// revision is the phone's own counter that the server never changes.
//   * applied=true: the sent revision is now on the server. If the phone changed the log meanwhile, send again.
//   * applied=false: the server refused (stale or locked). Fetch its doc and let resolveRefusal decide. When the
//     phone takes the server's doc over its own and that loses sets the phone had ticked (lostCompletedSets), the
//     phone's copy is kept (store.keepRejected) and onRejected tells the client.
//   * an error with hint 'not_a_client' (NOT_A_CLIENT): the coach removed this client. That is final: the log
//     leaves the phone (a copy is kept), onGone tells the client, and it is never retried.
// Finished logs waiting in the store's pending list (park(), so a new workout could start offline) are sent
// first, oldest first, with the same rules; the active log follows.
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
  /**
   * Called on every adopt, including ones during a background retry or a debounced push, with the server's doc
   * that now replaces the phone's copy. The screen must show it: edits are built from the store, so they stay
   * correct either way, but the screen would otherwise show an older doc.
   */
  onAdopt?: (doc: WorkoutLogDoc) => void;
  /** Called whenever status() changes (for the "Not synced yet" pill). Never after stop(). */
  onStatus?: (status: SyncStatus) => void;
  /**
   * The server's copy replaced the phone's (or a pending log was settled by it) and the phone had ticked sets
   * the server's copy lacks. `local` is the phone's copy, already kept with store.keepRejected.
   */
  onRejected?: (local: WorkoutLogDoc, lostSetIds: string[]) => void;
  /** The client is no longer a client of this log's coach: the log has left the phone (a copy is kept). */
  onGone?: (local: WorkoutLogDoc) => void;
  /**
   * The sync finished a forgotten workout itself (a retry 3 h after the last activity, with the app open), so
   * the screen can do what it does for a finish: cancel the reminder, show the note, remember it for Done ✓.
   * The doc may have uploaded and left the store by the time the screen reads it again.
   */
  onAutoFinish?: (doc: WorkoutLogDoc) => void;
};

export type LogSync = {
  push(): void;
  flushNow(): Promise<SyncResult>;
  status(): SyncStatus;
  /**
   * Sends the active log once even if it has synced, to learn whether the client is still with this coach
   * (for when the coach link changes). Refusals and the not-a-client answer are handled as usual.
   */
  recheck(): Promise<SyncResult>;
  /** Cancels the timers and makes every later push or flush a no-op. For sign-out and a change of user. */
  stop(): void;
};

/** The hint save_workout_log raises (42501) when the caller is no longer a client of the log's workspace. */
export const NOT_A_CLIENT = 'not_a_client';

/** True for save_workout_log's "no longer a client of this coach" refusal (log-api keeps the error's hint). */
export function isNotAClient(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { hint?: unknown }).hint === NOT_A_CLIENT;
}

/**
 * Ids of the sets the phone has ticked that the server's copy does not have ticked (missing, or not done there).
 * Pure. Non-empty means taking the server's doc over the phone's throws those sets away.
 */
export function lostCompletedSets(local: WorkoutLogDoc, server: WorkoutLogDoc): string[] {
  const done = new Set<string>();
  for (const b of server.blocks) for (const e of b.exercises) for (const x of e.sets) if (x.completedAt !== null) done.add(x.id);
  const lost: string[] = [];
  for (const b of local.blocks) for (const e of b.exercises) for (const x of e.sets) {
    if (x.completedAt !== null && !done.has(x.id)) lost.push(x.id);
  }
  return lost;
}

export type RefusalResolution = { kind: 'push' } | { kind: 'adopt'; stored: StoredLog } | { kind: 'retry' };

/**
 * What to do after the server refused a save. Pure.
 *   * push: the server still has the log in progress at an older revision (a duplicate save whose answer was
 *     lost), so the phone's newer copy should be sent again.
 *   * adopt: anything else. The log is locked (a coach correction, a manual finish or discard elsewhere)
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
  let stopped = false;
  function setStatus(next: SyncStatus) {
    if (next === current) return;
    current = next;
    if (stopped) return;
    try {
      deps.onStatus?.(next);
    } catch (e) {
      console.warn(`[log-sync] onStatus failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let failures = 0;
  let networkFailures = 0;
  let recheckNext = false;
  let cancelDebounce: (() => void) | null = null;
  let cancelRetry: (() => void) | null = null;
  // Flushes run one after another, so only one save is ever in flight.
  let queue: Promise<unknown> = Promise.resolve();

  function scheduleRetry() {
    cancelRetry?.();
    cancelRetry = null;
    if (stopped) return;
    const delay = RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length - 1)];
    failures += 1;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void flushNow();
    }, delay);
  }

  /** Loads the phone's copy, finishing a forgotten workout and dropping a finished one that is already saved. */
  async function prepare(): Promise<StoredLog | null> {
    let finished: WorkoutLogDoc | null = null;
    const stored = await store.update((s) => {
      if (s === null) return null;
      if (shouldAutoFinish(s.log, now())) {
        finished = autoFinish(s.log);
        return { ...s, log: finished };
      }
      if (isFinished(s.log) && isSynced(s)) return null;
      return s;
    });
    const f = finished as WorkoutLogDoc | null; // assigned inside the callback, which TS cannot see
    if (f) notify('onAutoFinish', deps.onAutoFinish, f);
    return stored;
  }

  /** save(), with the not-a-client refusal as a value instead of an error. */
  async function send(doc: WorkoutLogDoc): Promise<SaveLogResult | 'gone'> {
    // Never upload after stop(): a save now would go out under whoever is signed in next.
    if (stopped) throw new Error('log sync stopped');
    try {
      return await save(doc);
    } catch (e) {
      if (isNotAClient(e)) return 'gone';
      throw e;
    }
  }

  function notify<A extends unknown[]>(what: string, fn: ((...args: A) => void) | undefined, ...args: A) {
    if (stopped || !fn) return;
    try {
      fn(...args);
    } catch (e) {
      // A screen error must never stop the upload.
      console.warn(`[log-sync] ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function reject(local: WorkoutLogDoc, lost: string[]) {
    await store.keepRejected(local);
    notify('onRejected', deps.onRejected, local, lost);
  }

  /**
   * Sends the finished logs waiting in the pending list, oldest first. 'retry' when one could not be settled
   * now (its server copy can't be read), so the active log waits too and the whole flush backs off.
   */
  async function flushPending(): Promise<'done' | 'retry'> {
    for (const p of await store.loadPending()) {
      if (stopped) return 'done';
      const result = await send(p.log);
      networkFailures = 0;
      if (result === 'gone') {
        await store.keepRejected(p.log);
        await store.removePending(p.log.id);
        notify('onGone', deps.onGone, p.log);
        continue;
      }
      if (result.applied) {
        await store.removePending(p.log.id);
        continue;
      }
      const server = await fetchLog(p.log.id);
      const d = resolveRefusal(p.log, server);
      if (d.kind !== 'adopt') return 'retry';
      // The server's copy settles it. Nothing to show: this log is not open on the phone any more.
      const lost = lostCompletedSets(p.log, d.stored.log);
      if (lost.length > 0) await reject(p.log, lost);
      await store.removePending(p.log.id);
    }
    return 'done';
  }

  async function run(): Promise<SyncResult> {
    if (stopped) return { status: current, adopted: null };
    cancelRetry?.();
    cancelRetry = null;
    let adopted: WorkoutLogDoc | null = null;
    const finish = (status: SyncStatus): SyncResult => {
      // A push that arrived during this run is still waiting for its debounce: not synced yet.
      setStatus(status === 'synced' && cancelDebounce !== null ? 'pending' : status);
      return { status: current, adopted };
    };

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (stopped) return { status: current, adopted };
        if ((await flushPending()) === 'retry') {
          scheduleRetry();
          return finish('pending');
        }
        // Signed out while the pending list was uploading: the shared client may already belong to the next user.
        if (stopped) return { status: current, adopted };
        const stored = await prepare();
        const recheck = recheckNext && stored !== null && stored.log.status === 'in_progress';
        recheckNext = false;
        if (stored === null || (isSynced(stored) && !recheck)) {
          failures = 0;
          networkFailures = 0;
          return finish('synced');
        }

        const sent = stored.log;
        const result = await send(sent);
        networkFailures = 0; // the server answered, so the phone is online

        if (result === 'gone') {
          // Removed by the coach: final. The phone's latest copy is kept, then the log leaves the phone.
          let local: WorkoutLogDoc = sent;
          await store.update((s) => {
            if (s === null || s.log.id !== sent.id) return s;
            local = s.log;
            return null;
          });
          await store.keepRejected(local);
          notify('onGone', deps.onGone, local);
          continue;
        }

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
        let replaced: { local: WorkoutLogDoc; lost: string[] } | null = null;
        await store.update((s) => {
          if (s === null || s.log.id !== sent.id) return s; // the log is gone from the phone
          decision = resolveRefusal(s.log, server);
          if (decision.kind !== 'adopt') return s;
          const lost = lostCompletedSets(s.log, decision.stored.log);
          if (lost.length > 0) replaced = { local: s.log, lost };
          return decision.stored;
        });
        // Both are assigned inside the callback, which TS cannot see.
        const d = decision as RefusalResolution | null;
        const r = replaced as { local: WorkoutLogDoc; lost: string[] } | null;
        if (d?.kind === 'retry') {
          scheduleRetry();
          return finish('pending');
        }
        if (d?.kind === 'adopt') {
          adopted = d.stored.log;
          failures = 0;
          if (r) await reject(r.local, r.lost);
          notify('onAdopt', deps.onAdopt, adopted);
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
    if (stopped) return Promise.resolve({ status: current, adopted: null });
    cancelDebounce?.();
    cancelDebounce = null;
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    push() {
      if (stopped) return;
      if (current === 'synced') setStatus('pending');
      cancelDebounce?.();
      cancelDebounce = schedule(() => {
        cancelDebounce = null;
        void flushNow();
      }, SYNC_DEBOUNCE_MS);
    },
    flushNow,
    recheck() {
      recheckNext = true;
      return flushNow();
    },
    status: () => current,
    stop() {
      stopped = true;
      cancelDebounce?.();
      cancelDebounce = null;
      cancelRetry?.();
      cancelRetry = null;
    },
  };
}
