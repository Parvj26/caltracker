import { describe, expect, it } from 'vitest';
import { memoryStorage, sampleLog } from './log-fixtures';
import { createLogStore, logStoreKey } from './log-store';

describe('createLogStore', () => {
  it('returns an equal log after storing it, under the per-user key', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    const stored = { log: sampleLog({ revision: 3 }), lastSyncedRevision: 2 };
    await store.save(stored);
    expect(storage.map.has('caltracker.activeLog.user-1')).toBe(true);
    expect(logStoreKey('user-1')).toBe('caltracker.activeLog.user-1');
    // A fresh store over the same storage, as after an app restart.
    expect(await createLogStore(storage, 'user-1').load()).toEqual(stored);
    expect(await createLogStore(storage, 'user-2').load()).toBeNull();
  });

  it('returns null when nothing is stored', async () => {
    expect(await createLogStore(memoryStorage(), 'user-1').load()).toBeNull();
  });

  it('returns null for a corrupt value and removes it', async () => {
    const storage = memoryStorage();
    storage.map.set('caltracker.activeLog.user-1', '{not json');
    expect(await createLogStore(storage, 'user-1').load()).toBeNull();
    expect(storage.map.has('caltracker.activeLog.user-1')).toBe(false);
  });

  it('treats a value that is JSON but not a stored log as corrupt', async () => {
    const storage = memoryStorage();
    storage.map.set('caltracker.activeLog.user-1', JSON.stringify({ log: { id: 'x' }, lastSyncedRevision: 0 }));
    expect(await createLogStore(storage, 'user-1').load()).toBeNull();
    expect(storage.map.has('caltracker.activeLog.user-1')).toBe(false);
  });

  it('clears the stored log', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    await store.save({ log: sampleLog(), lastSyncedRevision: 0 });
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('updates in place, one change at a time, so concurrent updates never overwrite each other', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    await store.save({ log: sampleLog({ revision: 1 }), lastSyncedRevision: 0 });
    await Promise.all([
      store.update((s) => (s ? { ...s, log: { ...s.log, revision: s.log.revision + 1 } } : s)),
      store.update((s) => (s ? { ...s, lastSyncedRevision: 1 } : s)),
    ]);
    expect(await store.load()).toMatchObject({ log: { revision: 2 }, lastSyncedRevision: 1 });
    await store.update(() => null);
    expect(await store.load()).toBeNull();
  });
});
