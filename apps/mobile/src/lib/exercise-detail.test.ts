import { describe, expect, it, vi } from 'vitest';
import { DETAIL_KEY_PREFIX, createDetailCache, type ExerciseDetail } from './exercise-detail';
import { memoryStorage } from './log-fixtures';

const squat: ExerciseDetail = {
  id: 'e1',
  name: 'Barbell Squat',
  imagePaths: ['squat/0.jpg', 'squat/1.jpg'],
  primaryMuscles: ['quadriceps'],
  secondaryMuscles: ['glutes'],
  equipment: 'barbell',
  instructions: ['Set the bar on your back.', 'Squat down.'],
  videoUrl: null,
};

describe('createDetailCache', () => {
  it('fetches once, then answers from memory', async () => {
    const fetchRemote = vi.fn().mockResolvedValue([squat]);
    const cache = createDetailCache(memoryStorage(), fetchRemote);
    expect(await cache.load(['e1'])).toEqual({ e1: squat });
    expect(cache.peek('e1')).toEqual(squat);
    await cache.load(['e1']);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it('returns the stored data when the fetch fails (a fresh session, no signal)', async () => {
    const storage = memoryStorage();
    await createDetailCache(storage, () => Promise.resolve([squat])).load(['e1']);
    expect(storage.map.has(DETAIL_KEY_PREFIX + 'e1')).toBe(true);
    // A new app session: empty memory, same storage, server unreachable.
    const offline = createDetailCache(storage, () => Promise.reject(new Error('Network request failed')));
    expect(await offline.load(['e1'])).toEqual({ e1: squat });
  });

  it('leaves out an exercise found nowhere, and ignores an unreadable stored value', async () => {
    const storage = memoryStorage();
    storage.map.set(DETAIL_KEY_PREFIX + 'e2', '{not json');
    const cache = createDetailCache(storage, () => Promise.reject(new Error('offline')));
    expect(await cache.load(['e1', 'e2'])).toEqual({});
  });
});
