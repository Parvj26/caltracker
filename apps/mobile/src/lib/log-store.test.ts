import { describe, expect, it } from 'vitest';
import { memoryStorage, sampleLog } from './log-fixtures';
import { applyEdit, applyLiveEdit, createLogStore, logStoreKey, parkAction } from './log-store';

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

  it('reads a stored log naming a tracking type this build does not know as reps, keeping the numbers', async () => {
    const storage = memoryStorage();
    const log = sampleLog({ revision: 3 });
    const raw = JSON.parse(JSON.stringify({ log, lastSyncedRevision: 2 })) as { log: { blocks: { exercises: { trackingType: string }[] }[] } };
    raw.log.blocks[0].exercises[0].trackingType = 'sled_meters_per_minute';
    storage.map.set('caltracker.activeLog.user-1', JSON.stringify(raw));
    const loaded = await createLogStore(storage, 'user-1').load();
    expect(loaded?.log.blocks[0]!.exercises[0]!.trackingType).toBe('reps');
    expect(loaded?.log.blocks[0]!.exercises[0]!.sets).toEqual(log.blocks[0].exercises[0].sets);
  });

  it('keeps a log whose exercise measures weight, reps and time each side with a tempo', async () => {
    const storage = memoryStorage();
    const base = sampleLog({ revision: 3 });
    const ex = base.blocks[0].exercises[0];
    const log = {
      ...base,
      blocks: [
        {
          ...base.blocks[0],
          exercises: [{ ...ex, trackingType: 'weight_reps_time' as const, eachSide: true, tempo: '3-1-X-0', sets: [{ ...ex.sets[0], actualDurationS: 40 }] }],
        },
      ],
    };
    await createLogStore(storage, 'user-1').save({ log, lastSyncedRevision: 2 });
    const loaded = await createLogStore(storage, 'user-1').load();
    expect(loaded?.log.blocks[0]!.exercises[0]).toMatchObject({ trackingType: 'weight_reps_time', eachSide: true, tempo: '3-1-X-0' });
    expect(loaded?.log.blocks[0]!.exercises[0]!.sets[0]).toMatchObject({ actualReps: 8, actualWeightKg: 60, actualDurationS: 40 });
  });

  it('returns null when nothing is stored', async () => {
    expect(await createLogStore(memoryStorage(), 'user-1').load()).toBeNull();
  });

  it('returns null for a corrupt value and keeps it aside, never deleting it', async () => {
    const storage = memoryStorage();
    storage.map.set('caltracker.activeLog.user-1', '{not json');
    expect(await createLogStore(storage, 'user-1').load()).toBeNull();
    expect(storage.map.has('caltracker.activeLog.user-1')).toBe(false);
    expect(storage.map.get('caltracker.activeLog.user-1.corrupt')).toBe('{not json');
  });

  it('treats a value that is JSON but not a stored log as corrupt, and keeps it', async () => {
    const storage = memoryStorage();
    const raw = JSON.stringify({ log: { id: 'x' }, lastSyncedRevision: 0 });
    storage.map.set('caltracker.activeLog.user-1', raw);
    expect(await createLogStore(storage, 'user-1').load()).toBeNull();
    expect(storage.map.has('caltracker.activeLog.user-1')).toBe(false);
    expect(storage.map.get('caltracker.activeLog.user-1.corrupt')).toBe(raw);
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

describe('parkAction', () => {
  it('keeps nothing, a log in progress, or a finished log already uploaded', () => {
    expect(parkAction(null)).toBe('keep');
    expect(parkAction({ log: sampleLog({ revision: 4 }), lastSyncedRevision: 1 })).toBe('keep');
    expect(parkAction({ log: sampleLog({ status: 'completed', revision: 4 }), lastSyncedRevision: 4 })).toBe('keep');
  });

  it('parks a finished or discarded log waiting to upload, and drops a discard the server never saw', () => {
    expect(parkAction({ log: sampleLog({ status: 'completed', revision: 4 }), lastSyncedRevision: 0 })).toBe('park');
    expect(parkAction({ log: sampleLog({ status: 'discarded', revision: 4 }), lastSyncedRevision: 2 })).toBe('park');
    expect(parkAction({ log: sampleLog({ status: 'discarded', revision: 2 }), lastSyncedRevision: 0 })).toBe('drop');
  });
});

describe('park and the pending list', () => {
  const finished = (n: number, revision = 3) =>
    sampleLog({ id: `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`, status: 'completed', revision });

  it('moves a finished log waiting to upload to the pending list and frees the active slot, keeping its sets', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    const log = finished(1);
    await store.save({ log, lastSyncedRevision: 1 });
    expect(await store.park()).toBeNull();
    expect(await store.load()).toBeNull();
    expect(await store.loadPending()).toEqual([{ log, lastSyncedRevision: 1 }]);
    // Survives a restart.
    expect(await createLogStore(storage, 'user-1').loadPending()).toEqual([{ log, lastSyncedRevision: 1 }]);
  });

  it('keeps several, oldest first, replaces a log already pending, and removes one by id', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    await store.save({ log: finished(1), lastSyncedRevision: 0 });
    await store.park();
    await store.save({ log: finished(2), lastSyncedRevision: 0 });
    await store.park();
    // The same log again (the app died between the two writes of an earlier park).
    await store.save({ log: finished(1, 4), lastSyncedRevision: 0 });
    await store.park();
    expect((await store.loadPending()).map((p) => [p.log.id, p.log.revision])).toEqual([
      [finished(2).id, 3],
      [finished(1).id, 4],
    ]);
    await store.removePending(finished(2).id);
    expect((await store.loadPending()).map((p) => p.log.id)).toEqual([finished(1).id]);
    await store.removePending(finished(1).id);
    expect(await store.loadPending()).toEqual([]);
  });

  it('drops a discarded log the server never saw, and leaves a log in progress where it is', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    await store.save({ log: sampleLog({ status: 'discarded', revision: 2 }), lastSyncedRevision: 0 });
    expect(await store.park()).toBeNull();
    expect(await store.loadPending()).toEqual([]);
    const live = { log: sampleLog({ revision: 2 }), lastSyncedRevision: 0 };
    await store.save(live);
    expect(await store.park()).toEqual(live);
    expect(await store.load()).toEqual(live);
  });

  it('keeps the latest rejected copy under its own key', async () => {
    const storage = memoryStorage();
    const store = createLogStore(storage, 'user-1');
    await store.keepRejected(sampleLog({ name: 'First' }));
    await store.keepRejected(sampleLog({ name: 'Second' }));
    const kept = JSON.parse(storage.map.get('caltracker.activeLog.user-1.rejected') ?? '{}') as { log?: { name?: string } };
    expect(kept.log?.name).toBe('Second');
  });
});

describe('applyLiveEdit', () => {
  it('edits a log in progress', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    await store.save({ log: sampleLog({ revision: 3 }), lastSyncedRevision: 3 });
    expect(await applyLiveEdit(store, (log) => ({ ...log, notes: 'x', revision: log.revision + 1 }))).toMatchObject({
      log: { notes: 'x', revision: 4 },
    });
  });

  it('refuses an edit once the stored log is finished, e.g. an untick just after an automatic finish', async () => {
    const store = createLogStore(memoryStorage(), 'user-1');
    const done = { log: sampleLog({ status: 'completed', autoFinished: true, revision: 5 }), lastSyncedRevision: 4 };
    await store.save(done);
    expect(await applyLiveEdit(store, (log) => ({ ...log, notes: 'x', revision: log.revision + 1 }))).toEqual(done);
    expect(await store.load()).toEqual(done);
  });
});
