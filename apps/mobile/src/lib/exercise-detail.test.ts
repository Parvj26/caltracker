import { describe, expect, it, vi } from 'vitest';
import {
  DETAIL_MAX_ENTRIES,
  DETAIL_TTL_MS,
  createDetailCache,
  detailIndexKey,
  detailKey,
  type ExerciseDetail,
} from './exercise-detail';
import { memoryStorage } from './log-fixtures';

const make = (id: string, over: Partial<ExerciseDetail> = {}): ExerciseDetail => ({
  id,
  name: `Exercise ${id}`,
  imagePaths: [`${id}/0.jpg`, `${id}/1.jpg`],
  primaryMuscles: ['quadriceps'],
  secondaryMuscles: ['glutes'],
  equipment: 'barbell',
  instructions: ['Set the bar on your back.', 'Squat down.'],
  videoUrl: null,
  ...over,
});
const squat = make('e1');
const never = () => Promise.reject(new Error('Network request failed'));

describe('createDetailCache', () => {
  it('fetches once, then answers from memory', async () => {
    const fetchRemote = vi.fn().mockResolvedValue([squat]);
    const cache = createDetailCache(memoryStorage(), fetchRemote, 'u1');
    expect(await cache.load(['e1'])).toEqual({ e1: squat });
    expect(cache.peek('e1')).toEqual(squat);
    await cache.load(['e1']);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it('returns the stored data when the fetch fails (a fresh session, no signal)', async () => {
    const storage = memoryStorage();
    await createDetailCache(storage, () => Promise.resolve([squat]), 'u1').load(['e1']);
    expect(storage.map.has(detailKey('u1', 'e1'))).toBe(true);
    const offline = createDetailCache(storage, never, 'u1');
    expect(await offline.load(['e1'])).toEqual({ e1: squat });
  });

  it('leaves out an exercise found nowhere, and ignores an unreadable stored value', async () => {
    const storage = memoryStorage();
    storage.map.set(detailKey('u1', 'e2'), '{not json');
    expect(await createDetailCache(storage, never, 'u1').load(['e1', 'e2'])).toEqual({});
  });

  it('never shows one user’s entries to another user of the same phone', async () => {
    const storage = memoryStorage();
    await createDetailCache(storage, () => Promise.resolve([make('e1', { name: 'Coach A pinned' })]), 'user-a').load(['e1']);
    const b = createDetailCache(storage, never, 'user-b');
    expect(await b.load(['e1'])).toEqual({});
    expect(b.peek('e1')).toBeUndefined();
    // And user B's own copy doesn't touch A's.
    await createDetailCache(storage, () => Promise.resolve([make('e1', { name: 'Coach B' })]), 'user-b').load(['e1']);
    expect((await createDetailCache(storage, never, 'user-a').load(['e1']))['e1']?.name).toBe('Coach A pinned');
  });

  it('keeps only a real YouTube link, from the server and from storage', async () => {
    const storage = memoryStorage();
    const cache = createDetailCache(
      storage,
      () => Promise.resolve([make('e1', { videoUrl: 'javascript:alert(1)' }), make('e2', { videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })]),
      'u1',
    );
    const got = await cache.load(['e1', 'e2']);
    expect(got['e1']?.videoUrl).toBeNull();
    expect(got['e2']?.videoUrl).toMatch(/dQw4w9WgXcQ/);
    // A bad link written into storage by something else is dropped on the way back in.
    storage.map.set(detailKey('u2', 'e3'), JSON.stringify({ savedAt: 1, detail: make('e3', { videoUrl: 'https://evil.example/x' }) }));
    expect((await createDetailCache(storage, never, 'u2').load(['e3']))['e3']?.videoUrl).toBeNull();
  });

  it('fetches again after 24 hours, and keeps the old copy if that fails', async () => {
    let t = 1_000;
    const fetchRemote = vi.fn().mockResolvedValue([squat]);
    const cache = createDetailCache(memoryStorage(), fetchRemote, 'u1', () => t);
    await cache.load(['e1']);
    t += DETAIL_TTL_MS - 1;
    await cache.load(['e1']);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    t += 2;
    fetchRemote.mockRejectedValueOnce(new Error('offline'));
    expect(await cache.load(['e1'])).toEqual({ e1: squat });
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 200 entries and drops the oldest first', async () => {
    let t = 0;
    const storage = memoryStorage();
    const cache = createDetailCache(storage, (ids) => Promise.resolve(ids.map((id) => make(id))), 'u1', () => (t += 1));
    const ids = Array.from({ length: DETAIL_MAX_ENTRIES + 3 }, (_, i) => `x${i}`);
    for (const id of ids) await cache.load([id]);
    const index = JSON.parse(storage.map.get(detailIndexKey('u1')) ?? '[]') as { id: string }[];
    expect(index).toHaveLength(DETAIL_MAX_ENTRIES);
    expect(storage.map.has(detailKey('u1', 'x0'))).toBe(false);
    expect(storage.map.has(detailKey('u1', 'x2'))).toBe(false);
    expect(storage.map.has(detailKey('u1', 'x3'))).toBe(true);
    expect(storage.map.has(detailKey('u1', `x${DETAIL_MAX_ENTRIES + 2}`))).toBe(true);
  });
});
