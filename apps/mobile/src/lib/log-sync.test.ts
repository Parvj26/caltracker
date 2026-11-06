import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_FINISH_IDLE_MS, type WorkoutLogDoc } from '@caltracker/shared';
import { memoryStorage, sampleLog } from './log-fixtures';
import { createLogStore, type LogStore } from './log-store';
import {
  NOT_A_CLIENT,
  RETRY_BACKOFF_MS,
  SYNC_DEBOUNCE_MS,
  createLogSync,
  isExerciseUnavailable,
  isNotAClient,
  lostCompletedSets,
  resolveRefusal,
  type SaveLogResult,
} from './log-sync';

const networkError = () => new TypeError('Network request failed');
const applied = (doc: WorkoutLogDoc): SaveLogResult => ({ applied: true, revision: doc.revision, status: doc.status });

async function storeWith(log: WorkoutLogDoc, lastSyncedRevision = 0): Promise<LogStore> {
  const store = createLogStore(memoryStorage(), 'user-1');
  await store.save({ log, lastSyncedRevision });
  return store;
}

/** A save that resolves only when the test says so. */
function deferredSave() {
  const calls: { doc: WorkoutLogDoc; resolve: (r: SaveLogResult) => void }[] = [];
  const save = vi.fn(
    (doc: WorkoutLogDoc) => new Promise<SaveLogResult>((resolve) => calls.push({ doc, resolve })),
  );
  return { save, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  // 20 minutes after the sample log's last activity: well inside the auto-finish window.
  vi.setSystemTime(new Date('2026-11-05T09:30:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('timing constants', () => {
  it('debounces for 1 s and backs off 5 s, 15 s, 60 s, then 300 s', () => {
    expect(SYNC_DEBOUNCE_MS).toBe(1000);
    expect(RETRY_BACKOFF_MS).toEqual([5000, 15000, 60000, 300000]);
  });
});

describe('resolveRefusal', () => {
  it('keeps the local log and pushes again when the server is in progress at an older revision', () => {
    expect(resolveRefusal(sampleLog({ revision: 6 }), sampleLog({ revision: 5 }))).toEqual({ kind: 'push' });
  });

  it('adopts a log the coach corrected or someone finished, at its revision', () => {
    const server = sampleLog({ revision: 4, status: 'completed', finishedAt: '2026-11-05T10:00:00.000Z' });
    expect(resolveRefusal(sampleLog({ revision: 6 }), server)).toEqual({
      kind: 'adopt',
      stored: { log: server, lastSyncedRevision: 4 },
    });
  });

  it('adopts the server log when it is in progress at the same or a newer revision', () => {
    const same = sampleLog({ revision: 6, name: 'Server' });
    expect(resolveRefusal(sampleLog({ revision: 6 }), same)).toEqual({ kind: 'adopt', stored: { log: same, lastSyncedRevision: 6 } });
    const newer = sampleLog({ revision: 7, name: 'Server' });
    expect(resolveRefusal(sampleLog({ revision: 6 }), newer)).toEqual({ kind: 'adopt', stored: { log: newer, lastSyncedRevision: 7 } });
  });

  it('adopts a discarded server log even when the phone has a higher revision', () => {
    const server = sampleLog({ revision: 2, status: 'discarded' });
    expect(resolveRefusal(sampleLog({ revision: 9 }), server)).toMatchObject({ kind: 'adopt' });
  });

  it('keeps the local log and retries later when the server log cannot be read', () => {
    expect(resolveRefusal(sampleLog({ revision: 6 }), null)).toEqual({ kind: 'retry' });
  });
});

describe('createLogSync', () => {
  it('debounces: two pushes within 1 s save once', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    sync.push();
    expect(sync.status()).toBe('pending');
    await vi.advanceTimersByTimeAsync(500);
    sync.push();
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(sync.status()).toBe('synced');
    expect(await store.load()).toMatchObject({ lastSyncedRevision: 1 });
  });

  it('retries a failed save after 5 s and then 15 s, then records it as synced', async () => {
    const store = await storeWith(sampleLog({ revision: 3 }), 1);
    const save = vi
      .fn<(doc: WorkoutLogDoc) => Promise<SaveLogResult>>()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockImplementation((doc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });

    const first = await sync.flushNow();
    expect(first.status).toBe('pending');
    expect(sync.status()).toBe('pending');
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(sync.status()).toBe('offline');

    await vi.advanceTimersByTimeAsync(14999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(sync.status()).toBe('synced');
    expect(await store.load()).toMatchObject({ log: { revision: 3 }, lastSyncedRevision: 3 });

    // Nothing more is scheduled once it has synced.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('backs off 5 s, 15 s, 60 s, then 300 s steady', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const delays: number[] = [];
    const pending: (() => void)[] = [];
    const schedule = (fn: () => void, ms: number) => {
      delays.push(ms);
      pending.push(fn);
      return () => undefined;
    };
    const save = vi.fn(() => Promise.reject(networkError()));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, schedule });
    await sync.flushNow();
    for (let i = 0; i < 5; i++) {
      pending.shift()!(); // the retry fires; its flush schedules the next one once the save has failed
      await vi.waitFor(() => expect(pending).toHaveLength(1));
    }
    expect(delays).toEqual([5000, 15000, 60000, 300000, 300000, 300000]);
  });

  it('uploads the stored log after an app restart in the middle of retrying', async () => {
    const storage = memoryStorage();
    const before = createLogStore(storage, 'user-1');
    await before.save({ log: sampleLog({ revision: 4 }), lastSyncedRevision: 2 });
    const failing = createLogSync({
      save: vi.fn(() => Promise.reject(networkError())),
      fetchLog: vi.fn(),
      store: before,
      schedule: () => () => undefined, // the app is killed before the retry fires
    });
    expect((await failing.flushNow()).status).toBe('pending');

    // The app starts again: a new store and a new sync over the same phone storage.
    const after = createLogStore(storage, 'user-1');
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store: after });
    expect((await sync.flushNow()).status).toBe('synced');
    expect(save).toHaveBeenCalledWith(sampleLog({ revision: 4 }));
    expect(await after.load()).toMatchObject({ lastSyncedRevision: 4 });
  });

  it('(a) adopts a log the coach corrected and, as it is finished, clears the phone copy', async () => {
    const store = await storeWith(sampleLog({ revision: 6 }), 5);
    const server = sampleLog({
      revision: 5,
      status: 'completed',
      finishedAt: '2026-11-05T09:30:00.000Z',
      name: 'Corrected by coach',
    });
    const save = vi.fn((): Promise<SaveLogResult> => Promise.resolve({ applied: false, revision: 5, status: 'completed' }));
    const fetchLog = vi.fn(() => Promise.resolve(server));
    const sync = createLogSync({ save, fetchLog, store });

    const result = await sync.flushNow();
    expect(fetchLog).toHaveBeenCalledWith(server.id);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'synced', adopted: server });
    expect(await store.load()).toBeNull();
  });

  it('adopts an in-progress server log and keeps it on the phone', async () => {
    const store = await storeWith(sampleLog({ revision: 6 }), 5);
    const server = sampleLog({ revision: 6, name: 'Server copy' });
    const save = vi.fn((): Promise<SaveLogResult> => Promise.resolve({ applied: false, revision: 6, status: 'in_progress' }));
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(server)), store });
    expect(await sync.flushNow()).toEqual({ status: 'synced', adopted: server });
    expect(await store.load()).toEqual({ log: server, lastSyncedRevision: 6 });
  });

  it('(b) keeps the phone log and pushes again when the server is in progress at an older revision', async () => {
    const local = sampleLog({ revision: 6 });
    const store = await storeWith(local, 4);
    const save = vi
      .fn<(doc: WorkoutLogDoc) => Promise<SaveLogResult>>()
      .mockResolvedValueOnce({ applied: false, revision: 5, status: 'in_progress' })
      .mockImplementation((doc) => Promise.resolve(applied(doc)));
    const fetchLog = vi.fn(() => Promise.resolve(sampleLog({ revision: 5, name: 'Older' })));
    const sync = createLogSync({ save, fetchLog, store });

    const result = await sync.flushNow();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(local);
    expect(result).toEqual({ status: 'synced', adopted: null });
    expect(await store.load()).toEqual({ log: local, lastSyncedRevision: 6 });
  });

  it('does not spin when the server keeps refusing an in-progress log it holds at an older revision', async () => {
    const store = await storeWith(sampleLog({ revision: 6 }));
    const save = vi.fn((): Promise<SaveLogResult> => Promise.resolve({ applied: false, revision: 5, status: 'in_progress' }));
    const delays: number[] = [];
    const sync = createLogSync({
      save,
      fetchLog: vi.fn(() => Promise.resolve(sampleLog({ revision: 5 }))),
      store,
      schedule: (_fn, ms) => {
        delays.push(ms);
        return () => undefined;
      },
    });
    expect((await sync.flushNow()).status).toBe('pending');
    expect(save.mock.calls.length).toBeLessThanOrEqual(5);
    expect(delays).toEqual([5000]);
  });

  it('keeps the phone log and retries when the server refuses but its log cannot be read', async () => {
    const local = sampleLog({ revision: 6 });
    const store = await storeWith(local, 4);
    const save = vi.fn((): Promise<SaveLogResult> => Promise.resolve({ applied: false, revision: 5, status: 'in_progress' }));
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(null)), store });
    expect(await sync.flushNow()).toEqual({ status: 'pending', adopted: null });
    expect(await store.load()).toEqual({ log: local, lastSyncedRevision: 4 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(2);
    // The server answering does not reset the backoff: the next try is 15 s later, not 5 s.
    await vi.advanceTimersByTimeAsync(14999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('(c) pushes an edit made while a save is in flight once that save finishes, one save at a time', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const { save, calls } = deferredSave();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });

    const flushing = sync.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    // The client ticks another set while the first save is still on its way.
    await store.update((s) => (s ? { ...s, log: { ...s.log, revision: 2, notes: 'Second set' } } : s));
    sync.push();
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(calls).toHaveLength(1); // still waiting for the first save

    calls[0].resolve(applied(calls[0].doc));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].doc).toMatchObject({ revision: 2, notes: 'Second set' });
    expect(sync.status()).toBe('pending');

    calls[1].resolve(applied(calls[1].doc));
    await flushing;
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    expect(sync.status()).toBe('synced');
    expect(await store.load()).toMatchObject({ log: { revision: 2 }, lastSyncedRevision: 2 });
  });

  it('never runs two saves at once when flushed twice', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const { save, calls } = deferredSave();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    const a = sync.flushNow();
    const b = sync.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    calls[0].resolve(applied(calls[0].doc));
    await Promise.all([a, b]);
    expect(calls).toHaveLength(1); // the second flush found nothing new to send
  });

  it('(d) clears the phone copy once a finished log has synced', async () => {
    const done = sampleLog({ revision: 9, status: 'completed', finishedAt: '2026-11-05T09:40:00.000Z' });
    const store = await storeWith(done, 8);
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    expect(await sync.flushNow()).toEqual({ status: 'synced', adopted: null });
    expect(save).toHaveBeenCalledWith(done);
    expect(await store.load()).toBeNull();
  });

  it('clears a discarded log that has already synced without saving again', async () => {
    const store = await storeWith(sampleLog({ revision: 3, status: 'discarded' }), 3);
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    expect((await sync.flushNow()).status).toBe('synced');
    expect(save).not.toHaveBeenCalled();
    expect(await store.load()).toBeNull();
  });

  it('is synced with nothing to send when no log is stored', async () => {
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store: createLogStore(memoryStorage(), 'user-1') });
    expect(await sync.flushNow()).toEqual({ status: 'synced', adopted: null });
    expect(save).not.toHaveBeenCalled();
  });

  it('finishes a forgotten workout with the shared auto-finish rule before sending it', async () => {
    const log = sampleLog({ revision: 2 });
    const store = await storeWith(log, 2);
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const now = () => Date.parse(log.lastActivityAt) + AUTO_FINISH_IDLE_MS;
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, now });
    await sync.flushNow();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', autoFinished: true, finishedAt: '2026-11-05T09:10:00.000Z', revision: 3 }),
    );
    expect(await store.load()).toBeNull();
  });
  it('tells the screen when a background retry adopts the server doc', async () => {
    const store = await storeWith(sampleLog({ revision: 5 }), 4);
    const server = sampleLog({ revision: 7, name: 'Server copy' });
    const save = vi
      .fn<(doc: WorkoutLogDoc) => Promise<SaveLogResult>>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue({ applied: false, revision: 7, status: 'in_progress' });
    const onAdopt = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(server)), store, onAdopt });
    sync.push(); // debounced, so the screen never sees a flushNow result for any of this
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(onAdopt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onAdopt).toHaveBeenCalledWith(server);
    expect(await store.load()).toEqual({ log: server, lastSyncedRevision: 7 });
  });

  it('keeps syncing when the screen throws from onAdopt', async () => {
    const store = await storeWith(sampleLog({ revision: 5 }), 4);
    const server = sampleLog({ revision: 7 });
    const sync = createLogSync({
      save: vi.fn((): Promise<SaveLogResult> => Promise.resolve({ applied: false, revision: 7, status: 'in_progress' })),
      fetchLog: vi.fn(() => Promise.resolve(server)),
      store,
      onAdopt: () => {
        throw new Error('screen bug');
      },
    });
    expect(await sync.flushNow()).toEqual({ status: 'synced', adopted: server });
  });

  it('pushes when the phone moved on while a refused save was fetching the server doc', async () => {
    const store = await storeWith(sampleLog({ revision: 6 }), 5);
    let resolveFetch: (doc: WorkoutLogDoc) => void = () => undefined;
    const fetchLog = vi.fn(() => new Promise<WorkoutLogDoc | null>((r) => (resolveFetch = r)));
    const save = vi
      .fn<(doc: WorkoutLogDoc) => Promise<SaveLogResult>>()
      .mockResolvedValueOnce({ applied: false, revision: 6, status: 'in_progress' })
      .mockImplementation((doc) => Promise.resolve(applied(doc)));
    const onAdopt = vi.fn();
    const sync = createLogSync({ save, fetchLog, store, onAdopt });

    const flushing = sync.flushNow();
    await vi.waitFor(() => expect(fetchLog).toHaveBeenCalled());
    await store.update((s) => (s ? { ...s, log: { ...s.log, revision: 7, notes: 'Ticked meanwhile' } } : s));
    resolveFetch(sampleLog({ revision: 6 }));

    expect(await flushing).toEqual({ status: 'synced', adopted: null });
    expect(onAdopt).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 7, notes: 'Ticked meanwhile' }));
    expect(await store.load()).toMatchObject({ log: { revision: 7 }, lastSyncedRevision: 7 });
  });

  it('stays pending, not synced, while a push that arrived during a save waits for its debounce', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const { save, calls } = deferredSave();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    const flushing = sync.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    sync.push();
    calls[0].resolve(applied(calls[0].doc));
    expect((await flushing).status).toBe('pending');
    expect(sync.status()).toBe('pending');
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(sync.status()).toBe('synced');
    expect(calls).toHaveLength(1);
  });

  it('stop() cancels waiting pushes and retries and makes later calls do nothing', async () => {
    const store = await storeWith(sampleLog({ revision: 2 }));
    const save = vi.fn(() => Promise.reject(networkError()));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });

    sync.push();
    sync.stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(save).toHaveBeenCalledTimes(0);

    sync.push();
    expect(await sync.flushNow()).toEqual({ status: 'pending', adopted: null });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(save).toHaveBeenCalledTimes(0);
    expect(await store.load()).toMatchObject({ log: { revision: 2 }, lastSyncedRevision: 0 });
  });

  it('stop() while a pending log uploads never sends the active log under the next sign-in', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    const finished = sampleLog({ revision: 3, status: 'completed', finishedAt: '2026-11-05T10:00:00.000Z' });
    await store.save({ log: finished, lastSyncedRevision: 0 });
    await store.park();
    const active = sampleLog({ id: '00000000-0000-4000-8000-000000000999', revision: 2 });
    await store.save({ log: active, lastSyncedRevision: 0 });
    const { save, calls } = deferredSave();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    const flushing = sync.flushNow();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].doc.id).toBe(finished.id);
    sync.stop(); // signed out while the pending upload is on the wire
    calls[0].resolve(applied(calls[0].doc));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(calls).toHaveLength(1); // the active log was never sent
    await flushing;
  });

  it('stop() during a failing save leaves no retry behind', async () => {
    const store = await storeWith(sampleLog({ revision: 2 }));
    let rejectSave: (e: Error) => void = () => undefined;
    const save = vi.fn(() => new Promise<SaveLogResult>((_r, reject) => (rejectSave = reject)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    const flushing = sync.flushNow();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    sync.stop();
    rejectSave(networkError());
    await flushing;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('onStatus', () => {
  it('reports each change of status once: pending on push, synced after the upload, offline after two network failures', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const seen: string[] = [];
    let fail = true;
    const save = vi.fn((doc: WorkoutLogDoc) => (fail ? Promise.reject(networkError()) : Promise.resolve(applied(doc))));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, onStatus: (s) => seen.push(s) });
    sync.push();
    sync.push();
    expect(seen).toEqual(['pending']);
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS); // first failure: still pending
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]); // second failure: offline
    expect(seen).toEqual(['pending', 'offline']);
    fail = false;
    await sync.flushNow();
    expect(seen).toEqual(['pending', 'offline', 'synced']);
  });

  it('is silent after stop()', async () => {
    const store = await storeWith(sampleLog({ revision: 1 }));
    const seen: string[] = [];
    const sync = createLogSync({ save: vi.fn(), fetchLog: vi.fn(), store, onStatus: (s) => seen.push(s) });
    sync.stop();
    sync.push();
    await sync.flushNow();
    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Final review fixes: removed clients (I1), refusals that would drop ticked sets (I2), the pending list (I3).

/** What log-api throws for save_workout_log's 42501 with hint 'not_a_client'. */
const notAClient = () =>
  Object.assign(new Error('save_workout_log: Only a current client of this coach can save workouts.'), {
    code: '42501',
    hint: NOT_A_CLIENT,
  });
const sid = (n: number) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;
/** The sample log with sets 0..n-1 in its one exercise, the given ones ticked. */
function withTicked(over: Partial<WorkoutLogDoc>, sets: number, ticked: number[]): WorkoutLogDoc {
  const log = sampleLog(over);
  const ex = log.blocks[0].exercises[0];
  const proto = ex.sets[0];
  ex.sets = Array.from({ length: sets }, (_, i) => ({
    ...proto,
    id: sid(i),
    completedAt: ticked.includes(i) ? '2026-11-05T09:10:00.000Z' : null,
  }));
  return log;
}
const rejectedCopy = (storage: Map<string, string>) =>
  (JSON.parse(storage.get('caltracker.activeLog.user-1.rejected') ?? 'null') as { log: WorkoutLogDoc } | null)?.log ?? null;

describe('lostCompletedSets', () => {
  it('lists the sets ticked on the phone that the server copy lacks or has not ticked', () => {
    const local = withTicked({}, 4, [0, 1, 3]);
    const server = withTicked({}, 3, [0]);
    expect(lostCompletedSets(local, server)).toEqual([sid(1), sid(3)]);
  });

  it('is empty when the server has every ticked set (more, or different actuals, lose nothing)', () => {
    const local = withTicked({}, 2, [0]);
    const server = withTicked({}, 3, [0, 1, 2]);
    expect(lostCompletedSets(local, server)).toEqual([]);
    expect(lostCompletedSets(withTicked({}, 2, []), withTicked({}, 1, []))).toEqual([]);
  });
});

describe('isNotAClient', () => {
  it('is true only for the not_a_client hint, never for other errors', () => {
    expect(isNotAClient(notAClient())).toBe(true);
    expect(isNotAClient(Object.assign(new Error('permission denied for function'), { code: '42501' }))).toBe(false);
    expect(isNotAClient(networkError())).toBe(false);
    expect(isNotAClient(null)).toBe(false);
  });
});

describe('createLogSync: a removed client (I1)', () => {
  it('drops the log from the phone, keeps a copy, tells the screen once and never retries', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    const log = withTicked({ revision: 4 }, 2, [0]);
    await store.save({ log, lastSyncedRevision: 2 });
    const save = vi.fn(() => Promise.reject(notAClient()));
    const fetchLog = vi.fn();
    const onGone = vi.fn();
    const sync = createLogSync({ save, fetchLog, store, onGone });

    expect((await sync.flushNow()).status).toBe('synced');
    expect(await store.load()).toBeNull();
    expect(rejectedCopy(storage.map)).toEqual(log);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledWith(log);
    expect(fetchLog).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('recheck() sends a synced log in progress once, so a removal is noticed without a new edit', async () => {
    const store = await storeWith(sampleLog({ revision: 3 }), 3);
    const save = vi.fn(() => Promise.reject(notAClient()));
    const onGone = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, onGone });
    await sync.flushNow();
    expect(save).not.toHaveBeenCalled(); // synced: a normal flush sends nothing
    await sync.recheck();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(await store.load()).toBeNull();
  });

  it('recheck() of a client still with their coach keeps the log (the same revision is refused and adopted)', async () => {
    const log = sampleLog({ revision: 3 });
    const store = await storeWith(log, 3);
    const save = vi.fn(() => Promise.resolve<SaveLogResult>({ applied: false, revision: 3, status: 'in_progress' }));
    const onRejected = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(log)), store, onRejected });
    expect((await sync.recheck()).status).toBe('synced');
    expect(save).toHaveBeenCalledTimes(1);
    expect(await store.load()).toEqual({ log, lastSyncedRevision: 3 });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('keeps retrying other errors, including a 42501 without the hint', async () => {
    const store = await storeWith(sampleLog({ revision: 2 }), 1);
    const save = vi.fn(() => Promise.reject(Object.assign(new Error('permission denied'), { code: '42501' })));
    const onGone = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, onGone });
    expect((await sync.flushNow()).status).toBe('pending');
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(onGone).not.toHaveBeenCalled();
    expect(await store.load()).not.toBeNull();
  });
});

describe('createLogSync: a refusal that would drop ticked sets (I2)', () => {
  it('keeps the phone copy and tells the client when the adopted server doc lacks sets ticked on the phone', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    // The phone ticked sets 1 and 2 offline; the coach corrected the log meanwhile, which locks it.
    const local = withTicked({ revision: 6, status: 'completed', finishedAt: '2026-11-05T09:20:00.000Z' }, 3, [0, 1, 2]);
    const server = withTicked({ revision: 4, status: 'completed', finishedAt: '2026-11-05T09:12:00.000Z' }, 3, [0]);
    await store.save({ log: local, lastSyncedRevision: 4 });
    const save = vi.fn(() => Promise.resolve<SaveLogResult>({ applied: false, revision: 4, status: 'completed' }));
    const onRejected = vi.fn();
    const onAdopt = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(server)), store, onRejected, onAdopt });

    const result = await sync.flushNow();
    expect(result.adopted).toEqual(server);
    expect(onAdopt).toHaveBeenCalledWith(server);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith(local, [sid(1), sid(2)]);
    expect(rejectedCopy(storage.map)).toEqual(local);
  });

  it('says nothing and keeps no copy when the server doc has every ticked set', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    const local = withTicked({ revision: 6 }, 2, [0]);
    const server = withTicked({ revision: 7, status: 'completed', finishedAt: '2026-11-05T09:12:00.000Z' }, 2, [0, 1]);
    await store.save({ log: local, lastSyncedRevision: 5 });
    const save = vi.fn(() => Promise.resolve<SaveLogResult>({ applied: false, revision: 7, status: 'completed' }));
    const onRejected = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(server)), store, onRejected });
    await sync.flushNow();
    expect(onRejected).not.toHaveBeenCalled();
    expect(storage.map.has('caltracker.activeLog.user-1.rejected')).toBe(false);
  });
});

describe('createLogSync: the pending list (I3)', () => {
  const firstId = '00000000-0000-4000-8000-000000000901';
  async function parked(storage = memoryStorage()) {
    const store = createLogStore(storage, 'user-1');
    // Finished with no signal, then parked when the next workout started.
    const first = withTicked({ id: firstId, revision: 5, status: 'completed', finishedAt: '2026-11-05T09:12:00.000Z' }, 2, [0, 1]);
    await store.save({ log: first, lastSyncedRevision: 2 });
    await store.park();
    const second = sampleLog({ revision: 1 });
    await store.save({ log: second, lastSyncedRevision: 0 });
    return { store, storage, first, second };
  }

  it('uploads the parked log first, then the new one, and empties the pending list', async () => {
    const { store, first, second } = await parked();
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    expect((await sync.flushNow()).status).toBe('synced');
    expect(save.mock.calls.map(([d]) => d.id)).toEqual([first.id, second.id]);
    expect(await store.loadPending()).toEqual([]);
    expect(await store.load()).toMatchObject({ log: { id: second.id }, lastSyncedRevision: 1 });
  });

  it('keeps the parked log, with its sets, while there is no signal, and sends it when there is', async () => {
    const { store, first } = await parked();
    const save = vi
      .fn<(doc: WorkoutLogDoc) => Promise<SaveLogResult>>()
      .mockRejectedValueOnce(networkError())
      .mockImplementation((doc) => Promise.resolve(applied(doc)));
    const sync = createLogSync({ save, fetchLog: vi.fn(), store });
    expect((await sync.flushNow()).status).toBe('pending');
    expect(await store.loadPending()).toEqual([{ log: first, lastSyncedRevision: 2 }]);
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    expect(sync.status()).toBe('synced');
    expect(save.mock.calls[1]?.[0]).toEqual(first);
    expect(await store.loadPending()).toEqual([]);
  });

  it('settles a refused parked log by the server copy, keeping the phone copy when that loses ticked sets', async () => {
    const { store, storage, first } = await parked();
    const server = withTicked({ id: firstId, revision: 2, status: 'completed', finishedAt: '2026-11-05T09:12:00.000Z' }, 2, [0]);
    const save = vi.fn((doc: WorkoutLogDoc) =>
      Promise.resolve<SaveLogResult>(doc.id === firstId ? { applied: false, revision: 2, status: 'completed' } : applied(doc)),
    );
    const onRejected = vi.fn();
    const onAdopt = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(server)), store, onRejected, onAdopt });
    expect((await sync.flushNow()).status).toBe('synced');
    expect(await store.loadPending()).toEqual([]);
    expect(onRejected).toHaveBeenCalledWith(first, [sid(1)]);
    expect(onAdopt).not.toHaveBeenCalled(); // the screen shows the new workout, not this one
    expect(rejectedCopy(storage.map)).toEqual(first);
  });

  it('waits, sending nothing else, when a refused parked log has no readable server copy', async () => {
    const { store, first } = await parked();
    const save = vi.fn(() => Promise.resolve<SaveLogResult>({ applied: false, revision: 9, status: 'completed' }));
    const sync = createLogSync({ save, fetchLog: vi.fn(() => Promise.resolve(null)), store });
    expect((await sync.flushNow()).status).toBe('pending');
    expect(save).toHaveBeenCalledTimes(1);
    expect(await store.loadPending()).toEqual([{ log: first, lastSyncedRevision: 2 }]);
  });

  it('drops a parked log of a removed client and tells the screen', async () => {
    const { store, first } = await parked();
    const save = vi.fn(() => Promise.reject(notAClient()));
    const onGone = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, onGone });
    await sync.flushNow();
    expect(await store.loadPending()).toEqual([]);
    expect(onGone).toHaveBeenNthCalledWith(1, first);
    expect(onGone).toHaveBeenCalledTimes(2); // the new workout is refused the same way
    expect(await store.load()).toBeNull();
  });
});

describe('createLogSync: housekeeping after its own auto-finish (M4)', () => {
  it('tells the screen when a retry finishes a forgotten workout, even though it then uploads and leaves the store', async () => {
    const log = sampleLog({ revision: 2 });
    const store = await storeWith(log, 2);
    const save = vi.fn((doc: WorkoutLogDoc) => Promise.resolve(applied(doc)));
    const onAutoFinish = vi.fn();
    const now = () => Date.parse(log.lastActivityAt) + AUTO_FINISH_IDLE_MS;
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, now, onAutoFinish });
    await sync.flushNow();
    expect(onAutoFinish).toHaveBeenCalledTimes(1);
    expect(onAutoFinish).toHaveBeenCalledWith(expect.objectContaining({ id: log.id, status: 'completed', autoFinished: true }));
    expect(await store.load()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Exercise-search final fixes: a log naming an exercise that was deleted (or is no longer the workspace's) is
// refused by save_workout_log with 42501 "Exercise <id> is not available in this workspace." That never changes on
// a retry, so it is final like the removed-client refusal.

/** What log-api throws for that refusal: the message keeps the server's words, with no hint. */
const unavailable = () =>
  Object.assign(
    new Error('save_workout_log: Exercise 00000000-0000-4000-8000-0000000000e1 is not available in this workspace.'),
    { code: '42501', hint: null },
  );

describe('isExerciseUnavailable', () => {
  it('is true only for the unavailable-exercise refusal', () => {
    expect(isExerciseUnavailable(unavailable())).toBe(true);
    expect(isExerciseUnavailable(notAClient())).toBe(false);
    // Same words but another code (say, a proxy rewording): not ours.
    expect(isExerciseUnavailable(Object.assign(new Error(unavailable().message), { code: '23514' }))).toBe(false);
    expect(isExerciseUnavailable(Object.assign(new Error('permission denied'), { code: '42501' }))).toBe(false);
    expect(isExerciseUnavailable(networkError())).toBe(false);
    expect(isExerciseUnavailable(null)).toBe(false);
  });
});

describe('createLogSync: a log with an exercise that is no longer available', () => {
  it('drops the log from the phone, keeps a copy, tells the screen once and never retries', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    const log = withTicked({ revision: 4 }, 2, [0]);
    await store.save({ log, lastSyncedRevision: 2 });
    const save = vi.fn(() => Promise.reject(unavailable()));
    const onUnavailable = vi.fn();
    const onGone = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, onUnavailable, onGone });

    expect((await sync.flushNow()).status).toBe('synced');
    expect(await store.load()).toBeNull();
    expect(rejectedCopy(storage.map)).toEqual(log);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith(log);
    expect(onGone).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('drops a parked log the same way and still sends the next one', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    const first = withTicked({ id: '00000000-0000-4000-8000-000000000911', revision: 5, status: 'completed', finishedAt: '2026-11-05T09:12:00.000Z' }, 2, [0, 1]);
    await store.save({ log: first, lastSyncedRevision: 2 });
    await store.park();
    const second = sampleLog({ revision: 1 });
    await store.save({ log: second, lastSyncedRevision: 0 });
    const save = vi.fn((doc: WorkoutLogDoc) => (doc.id === first.id ? Promise.reject(unavailable()) : Promise.resolve(applied(doc))));
    const onUnavailable = vi.fn();
    const sync = createLogSync({ save, fetchLog: vi.fn(), store, onUnavailable });
    expect((await sync.flushNow()).status).toBe('synced');
    expect(await store.loadPending()).toEqual([]);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith(first);
    expect(await store.load()).toMatchObject({ log: { id: second.id }, lastSyncedRevision: 1 });
  });
});
