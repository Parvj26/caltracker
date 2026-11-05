import { describe, expect, it } from 'vitest';
import { memoryStorage, sampleLog } from './log-fixtures';
import { applyEdit, createLogStore, logStoreKey } from './log-store';

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

describe('applyEdit', () => {
  it('builds the edit from the stored doc and keeps lastSyncedRevision', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    // The sync adopted the server's doc at revision 7 while the screen still showed revision 5.
    await store.save({ log: sampleLog({ revision: 7, name: 'Server copy' }), lastSyncedRevision: 7 });
    const next = await applyEdit(store, (log) => ({ ...log, notes: 'Ticked', revision: log.revision + 1 }));
    expect(next).toMatchObject({ log: { revision: 8, name: 'Server copy', notes: 'Ticked' }, lastSyncedRevision: 7 });
    expect(await store.load()).toEqual(next);
  });

  it('raises the revision above the stored one even if the op did not', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    await store.save({ log: sampleLog({ revision: 7 }), lastSyncedRevision: 7 });
    expect(await applyEdit(store, (log) => ({ ...log, notes: 'x', revision: 5 }))).toMatchObject({ log: { revision: 8 } });
  });

  it('leaves the store alone when the op changes nothing or nothing is stored', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    expect(await applyEdit(store, (log) => ({ ...log, revision: log.revision + 1 }))).toBeNull();
    await store.save({ log: sampleLog({ revision: 3 }), lastSyncedRevision: 3 });
    expect(await applyEdit(store, (log) => log)).toMatchObject({ log: { revision: 3 } });
  });
});
