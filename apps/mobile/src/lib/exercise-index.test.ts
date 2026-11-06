import { describe, expect, it, vi } from 'vitest';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { EXERCISE_INDEX_KEY, EXERCISE_INDEX_TTL_MS, createExerciseIndexLoader } from './exercise-index';
import { memoryStorage } from './log-fixtures';

const row = (id: string, over: Partial<ExerciseIndexRow> = {}): ExerciseIndexRow => ({
  id,
  name: `Exercise ${id}`,
  primaryMuscles: ['chest'],
  secondaryMuscles: [],
  equipment: 'dumbbell',
  category: 'strength',
  trackingType: 'weight_reps',
  source: 'builtin',
  imagePath: null,
  ...over,
});
const never = () => Promise.reject(new Error('Network request failed'));

describe('createExerciseIndexLoader', () => {
  it('fetches on first use and stores the library under the versioned key', async () => {
    const storage = memoryStorage();
    const fetchRows = vi.fn().mockResolvedValue([row('a')]);
    const load = createExerciseIndexLoader(storage, fetchRows, 'u1', () => 1000);
    expect(await load()).toEqual({ rows: [row('a')], fromCache: false, refreshFailed: false });
    expect([...storage.map.keys()].some((k) => k.startsWith(EXERCISE_INDEX_KEY))).toBe(true);
  });

  it('answers from storage without fetching when it is younger than 24 hours', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const fetchRows = vi.fn().mockResolvedValue([row('b')]);
    const r = await createExerciseIndexLoader(storage, fetchRows, 'u1', () => EXERCISE_INDEX_TTL_MS - 1)();
    expect(r).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: false });
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it('refreshes when the stored library is older than 24 hours', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const fetchRows = vi.fn().mockResolvedValue([row('b')]);
    const r = await createExerciseIndexLoader(storage, fetchRows, 'u1', () => EXERCISE_INDEX_TTL_MS + 1)();
    expect(r).toEqual({ rows: [row('b')], fromCache: false, refreshFailed: false });
    // And the new copy is what is stored now.
    const again = await createExerciseIndexLoader(storage, never, 'u1', () => EXERCISE_INDEX_TTL_MS + 2)();
    expect(again.rows).toEqual([row('b')]);
  });

  it('returns the stored library when the fetch rejects', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const r = await createExerciseIndexLoader(storage, never, 'u1', () => EXERCISE_INDEX_TTL_MS * 3)();
    expect(r).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: true });
  });

  it('fails when there is nothing stored and the fetch rejects', async () => {
    await expect(createExerciseIndexLoader(memoryStorage(), never, 'u1')()).rejects.toThrow();
  });

  it('ignores an unreadable stored value', async () => {
    const storage = memoryStorage();
    storage.map.set(`${EXERCISE_INDEX_KEY}.u1`, '{not json');
    const r = await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1')();
    expect(r.rows).toEqual([row('a')]);
  });

  it('never shows one user’s library to another user of the same phone', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a', { source: 'custom' })]), 'u1')();
    await expect(createExerciseIndexLoader(storage, never, 'u2')()).rejects.toThrow();
  });

  it('shares one fetch between two calls at the same time', async () => {
    const fetchRows = vi.fn().mockResolvedValue([row('a')]);
    const load = createExerciseIndexLoader(memoryStorage(), fetchRows, 'u1');
    await Promise.all([load(), load()]);
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });
});
