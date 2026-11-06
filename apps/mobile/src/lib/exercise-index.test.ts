import { describe, expect, it, vi } from 'vitest';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { LAST_USER_KEY, forgetIndexUser, EXERCISE_INDEX_KEY, EXERCISE_INDEX_TTL_MS, createExerciseIndexLoader as makeLoader, resolveIndexUser } from './exercise-index';
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
type Store = ReturnType<typeof memoryStorage>;
// In the app the signed-in user is remembered before the loader runs; do the same here.
const createExerciseIndexLoader = (s: Store, f: Parameters<typeof makeLoader>[1], u: string, n?: () => number) => {
  s.map.set(LAST_USER_KEY, u);
  return makeLoader(s, f, u, n);
};
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

  it('returns an old saved library at once and refreshes it in the background', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    let release: (r: ExerciseIndexRow[]) => void = () => undefined;
    const fetchRows = vi.fn(() => new Promise<ExerciseIndexRow[]>((res) => (release = res)));
    const updates: unknown[] = [];
    const landed = new Promise<void>((done) => {
      const load = createExerciseIndexLoader(storage, fetchRows, 'u1', () => EXERCISE_INDEX_TTL_MS + 1);
      void load((n) => {
        updates.push(n);
        done();
      }).then((first) => {
        expect(first).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: false });
        expect(updates).toEqual([]);
        release([row('b')]);
      });
    });
    await landed;
    expect(updates).toEqual([{ rows: [row('b')], fromCache: false, refreshFailed: false }]);
    // The new copy is what is stored now.
    const again = await createExerciseIndexLoader(storage, never, 'u1', () => EXERCISE_INDEX_TTL_MS + 2)();
    expect(again.rows).toEqual([row('b')]);
  });

  it('keeps the saved library and reports refreshFailed when the background refresh rejects', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const update = await new Promise((done) => {
      void createExerciseIndexLoader(storage, never, 'u1', () => EXERCISE_INDEX_TTL_MS * 3)(done);
    });
    expect(update).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: true });
  });

  it('treats a clock set back (negative age) as old and refreshes', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 10_000)();
    const update = await new Promise((done) => {
      void createExerciseIndexLoader(storage, () => Promise.resolve([row('b')]), 'u1', () => 5_000)(done);
    });
    expect(update).toEqual({ rows: [row('b')], fromCache: false, refreshFailed: false });
  });

  it('ignores stored JSON with the wrong shape', async () => {
    for (const bad of [
      { ...row('a'), source: 'other' },
      { ...row('a'), equipment: 5 },
      { ...row('a'), category: [] },
      { ...row('a'), imagePath: 1 },
      { ...row('a'), primaryMuscles: [1] },
    ]) {
      const storage = memoryStorage();
      storage.map.set(`${EXERCISE_INDEX_KEY}.u1`, JSON.stringify({ savedAt: 0, rows: [bad] }));
      const r = await createExerciseIndexLoader(storage, () => Promise.resolve([row('z')]), 'u1', () => 1)();
      expect(r.rows).toEqual([row('z')]);
    }
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

describe('resolveIndexUser', () => {
  const keysOf = (storage: ReturnType<typeof memoryStorage>) => () => Promise.resolve([...storage.map.keys()]);

  it('uses the signed-in user and remembers them', async () => {
    const storage = memoryStorage();
    expect(await resolveIndexUser(storage, keysOf(storage), 'u1')).toBe('u1');
    // Later, offline with an expired token and no readable session: the last user's saved library is used.
    expect(await resolveIndexUser(storage, keysOf(storage), null)).toBe('u1');
  });

  it('serves the saved library offline with no session', async () => {
    const storage = memoryStorage();
    await resolveIndexUser(storage, keysOf(storage), 'u1');
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const id = await resolveIndexUser(storage, keysOf(storage), null);
    const r = await createExerciseIndexLoader(storage, never, id as string, () => 1000)();
    expect(r.rows).toEqual([row('a')]);
  });

  it('is null when nobody has signed in on this phone', async () => {
    const storage = memoryStorage();
    expect(await resolveIndexUser(storage, keysOf(storage), null)).toBeNull();
  });

  it('removes the previous user’s saved library when a different user signs in', async () => {
    const storage = memoryStorage();
    await resolveIndexUser(storage, keysOf(storage), 'u1');
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1')();
    await resolveIndexUser(storage, keysOf(storage), 'u2');
    expect(storage.map.has(`${EXERCISE_INDEX_KEY}.u1`)).toBe(false);
  });
});

describe('sign-out and changes of user', () => {
  it('forgetIndexUser removes the remembered user and their saved library, and nobody else’s', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    storage.map.set(`${EXERCISE_INDEX_KEY}.other`, 'x');
    await forgetIndexUser(storage);
    expect(storage.map.has(LAST_USER_KEY)).toBe(false);
    expect(storage.map.has(`${EXERCISE_INDEX_KEY}.u1`)).toBe(false);
    expect(storage.map.has(`${EXERCISE_INDEX_KEY}.other`)).toBe(true);
    await expect(createExerciseIndexLoader(memoryStorage(), never, 'u1')()).rejects.toThrow();
  });

  it('saves nothing and tells nobody when the user changed during the fetch', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    let release: (r: ExerciseIndexRow[]) => void = () => undefined;
    const onUpdate = vi.fn();
    await makeLoader(storage, () => new Promise((res) => (release = res)), 'u1', () => EXERCISE_INDEX_TTL_MS + 1)(onUpdate);
    await forgetIndexUser(storage);
    release([row('b')]);
    await new Promise((r) => setTimeout(r, 0));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(storage.map.has(`${EXERCISE_INDEX_KEY}.u1`)).toBe(false);
  });
});
