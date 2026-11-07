import { describe, expect, it, vi } from 'vitest';
import { buildExerciseIndex, type ExerciseIndexRow } from '@caltracker/shared';
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
const createExerciseIndexLoader = (
  s: Store,
  f: Parameters<typeof makeLoader>[1],
  u: string,
  n?: () => number,
  b?: Parameters<typeof makeLoader>[4],
) => {
  s.map.set(LAST_USER_KEY, u);
  return makeLoader(s, f, u, n, b);
};
/** The loaded result without its built index, for comparing. */
const plain = (r: unknown) => {
  const rest: Record<string, unknown> = { ...(r as Record<string, unknown>) };
  delete rest.index;
  return rest;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const never = () => Promise.reject(new Error('Network request failed'));

describe('createExerciseIndexLoader', () => {
  it('fetches on first use and stores the library under the versioned key', async () => {
    const storage = memoryStorage();
    const fetchRows = vi.fn().mockResolvedValue([row('a')]);
    const load = createExerciseIndexLoader(storage, fetchRows, 'u1', () => 1000);
    const first = await load();
    expect(plain(first)).toEqual({ rows: [row('a')], fromCache: false, refreshFailed: false });
    expect(first.index.rows).toEqual([row('a')]);
    expect([...storage.map.keys()].some((k) => k.startsWith(EXERCISE_INDEX_KEY))).toBe(true);
  });

  it('reads a saved row with a tracking type this build does not know as reps', async () => {
    const storage = memoryStorage();
    const future = row('f', { trackingType: 'sled_meters_per_minute' as unknown as ExerciseIndexRow['trackingType'] });
    await createExerciseIndexLoader(storage, () => Promise.resolve([future]), 'u1', () => 0)();
    const r = await createExerciseIndexLoader(storage, never, 'u1', () => 1)();
    expect(r.fromCache).toBe(true);
    expect(r.rows.map((x) => x.trackingType)).toEqual(['reps']);
  });

  it('answers from a young saved copy at once and still refreshes it in the background', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const fetchRows = vi.fn().mockResolvedValue([row('a'), row('custom', { source: 'custom' })]);
    const updates: unknown[] = [];
    const r = await createExerciseIndexLoader(storage, fetchRows, 'u1', () => 60_000)((n) => updates.push(plain(n)));
    expect(plain(r)).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: false });
    await tick();
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([{ rows: [row('a'), row('custom', { source: 'custom' })], fromCache: false, refreshFailed: false }]);
  });

  it('says nothing when a young copy cannot be refreshed (no "Using saved library")', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const onUpdate = vi.fn();
    const r = await createExerciseIndexLoader(storage, never, 'u1', () => EXERCISE_INDEX_TTL_MS - 1)(onUpdate);
    expect(r.rows).toEqual([row('a')]);
    await tick();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('says nothing when the refresh brings the same rows, and keeps the built index', async () => {
    const storage = memoryStorage();
    const build = vi.fn(buildExerciseIndex);
    let clock = 0;
    const load = createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => clock, build);
    const first = await load();
    clock = 1000;
    const onUpdate = vi.fn();
    const second = await load(onUpdate);
    await tick();
    expect(onUpdate).not.toHaveBeenCalled();
    clock = 2000;
    const third = await load();
    await tick();
    expect(second.index).toBe(first.index);
    expect(third.index).toBe(first.index);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds the search index once per saved copy, not on every open', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const build = vi.fn(buildExerciseIndex);
    const load = createExerciseIndexLoader(storage, never, 'u1', () => 1000, build);
    const a = await load();
    const b = await load();
    expect(b.index).toBe(a.index);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the index when a refresh brings new rows, then reuses that one', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 0)();
    const build = vi.fn(buildExerciseIndex);
    const load = createExerciseIndexLoader(storage, () => Promise.resolve([row('b')]), 'u1', () => 1000, build);
    const updated = await new Promise<Awaited<ReturnType<typeof load>>>((done) => void load(done));
    expect(updated.index.rows).toEqual([row('b')]);
    const again = await load();
    expect(again.index).toBe(updated.index);
    expect(build).toHaveBeenCalledTimes(2); // the saved copy, then the new rows
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
        updates.push(plain(n));
        done();
      }).then((first) => {
        expect(plain(first)).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: false });
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
    expect(plain(update)).toEqual({ rows: [row('a')], fromCache: true, refreshFailed: true });
  });

  it('treats a clock set back (negative age) as old and refreshes', async () => {
    const storage = memoryStorage();
    await createExerciseIndexLoader(storage, () => Promise.resolve([row('a')]), 'u1', () => 10_000)();
    const update = await new Promise((done) => {
      void createExerciseIndexLoader(storage, () => Promise.resolve([row('b')]), 'u1', () => 5_000)(done);
    });
    expect(plain(update)).toEqual({ rows: [row('b')], fromCache: false, refreshFailed: false });
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
