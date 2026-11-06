// The exercise library the phone searches while logging. Kept in AsyncStorage so "+ Exercise" works with no signal,
// and refreshed in the background each time the picker opens. Storage and the server call are injected, so tests
// need neither.
// One copy per signed-in user (custom exercises belong to a workspace), keyed `caltracker.exerciseIndex.v1.<user id>`.
import { buildExerciseIndex, type ExerciseIndex, type ExerciseIndexRow } from '@caltracker/shared';
import type { KeyValueStorage } from './log-store';

export const EXERCISE_INDEX_KEY = 'caltracker.exerciseIndex.v1';
export const EXERCISE_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

export type LoadedExerciseIndex = {
  rows: ExerciseIndexRow[];
  /** The search index built from `rows` (reused while the rows are unchanged). */
  index: ExerciseIndex;
  /** True when the rows came from the phone's storage rather than a fresh fetch. */
  fromCache: boolean;
  /** True when the saved library is over a day old and the refresh failed ("Using saved library"). */
  refreshFailed: boolean;
};

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function isRow(r: unknown): r is ExerciseIndexRow {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    isStrings(o.primaryMuscles) &&
    isStrings(o.secondaryMuscles) &&
    isStrOrNull(o.equipment) &&
    isStrOrNull(o.category) &&
    typeof o.trackingType === 'string' &&
    (o.source === 'builtin' || o.source === 'custom') &&
    isStrOrNull(o.imagePath)
  );
}

async function readStored(storage: KeyValueStorage, key: string): Promise<{ savedAt: number; rows: ExerciseIndexRow[] } | null> {
  try {
    const raw = await storage.getItem(key);
    if (raw === null) return null;
    const p = JSON.parse(raw) as { savedAt?: unknown; rows?: unknown };
    if (typeof p.savedAt !== 'number' || !Array.isArray(p.rows) || !p.rows.every(isRow)) return null;
    return { savedAt: p.savedAt, rows: p.rows };
  } catch {
    return null; // unreadable storage is the same as nothing stored
  }
}

export const LAST_USER_KEY = 'caltracker.exerciseIndexUser.v1';

/**
 * Whose library to use: the signed-in user's, or (when the session can't be read, e.g. offline with an expired
 * token) the last user who was signed in on this phone. Remembers the signed-in user, and removes the saved
 * library of anyone else so one account's custom exercises never stay on the phone for the next.
 */
export async function resolveIndexUser(
  storage: KeyValueStorage,
  listKeys: () => Promise<readonly string[]>,
  sessionUserId: string | null,
): Promise<string | null> {
  if (!sessionUserId) {
    try {
      return await storage.getItem(LAST_USER_KEY);
    } catch {
      return null;
    }
  }
  try {
    if ((await storage.getItem(LAST_USER_KEY)) !== sessionUserId) {
      const mine = `${EXERCISE_INDEX_KEY}.${sessionUserId}`;
      const others = (await listKeys()).filter((k) => k.startsWith(`${EXERCISE_INDEX_KEY}.`) && k !== mine);
      await Promise.all(others.map((k) => storage.removeItem(k)));
      await storage.setItem(LAST_USER_KEY, sessionUserId);
    }
  } catch {
    // Housekeeping only; never blocks the picker.
  }
  return sessionUserId;
}

/** Explicit sign-out: forget who was signed in and remove their saved library. Not for token-refresh failures. */
export async function forgetIndexUser(storage: KeyValueStorage): Promise<void> {
  try {
    const last = await storage.getItem(LAST_USER_KEY);
    await storage.removeItem(LAST_USER_KEY);
    if (last) await storage.removeItem(`${EXERCISE_INDEX_KEY}.${last}`);
  } catch {
    // Nothing more to do; the next sign-in prunes anyway.
  }
}

/**
 * Returns the saved library at once and always refreshes it in the background, so a custom exercise the coach
 * just added (or removed) shows up the next time the picker opens. `onUpdate` hears the new rows only when they
 * differ from the saved ones. When the refresh fails, the saved copy is kept; only a copy older than 24 hours (or
 * from a clock set back) is reported as `refreshFailed` ("Using saved library"). With nothing saved it waits for
 * the fetch (and rejects if that fails).
 *
 * The built search index is kept in memory beside the rows, so opening the picker again does not rebuild it.
 */
export function createExerciseIndexLoader(
  storage: KeyValueStorage,
  fetchRows: () => Promise<ExerciseIndexRow[]>,
  userId: string,
  now: () => number = Date.now,
  build: (rows: ExerciseIndexRow[]) => ExerciseIndex = buildExerciseIndex,
): (onUpdate?: (next: LoadedExerciseIndex) => void) => Promise<LoadedExerciseIndex> {
  const key = `${EXERCISE_INDEX_KEY}.${userId}`;
  /** The saved copy (by when it was saved), its rows as JSON for comparing with a refresh, and its built index. */
  let memo: { savedAt: number; json: string; rows: ExerciseIndexRow[]; index: ExerciseIndex } | null = null;
  const indexed = (savedAt: number, rows: ExerciseIndexRow[]) => {
    if (memo?.savedAt !== savedAt) memo = { savedAt, json: JSON.stringify(rows), rows, index: build(rows) };
    return memo;
  };

  type Fetched = { rows: ExerciseIndexRow[]; index: ExerciseIndex; changed: boolean; stillMine: boolean };
  let inFlight: Promise<Fetched> | null = null;
  const fetchAndSave = () => {
    inFlight ??= fetchRows()
      .then(async (rows): Promise<Fetched> => {
        // The user may have signed out, or someone else signed in, while this was loading: then save nothing.
        const stillMine = (await storage.getItem(LAST_USER_KEY).catch(() => null)) === userId;
        if (!stillMine) return { rows, index: build(rows), changed: true, stillMine };
        const savedAt = now();
        const json = JSON.stringify(rows);
        const changed = memo?.json !== json;
        memo = changed || !memo ? { savedAt, json, rows, index: build(rows) } : { ...memo, savedAt };
        await storage.setItem(key, JSON.stringify({ savedAt, rows })).catch(() => undefined);
        return { rows: memo.rows, index: memo.index, changed, stillMine };
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return async (onUpdate) => {
    const stored = await readStored(storage, key);
    if (!stored) {
      const fetched = await fetchAndSave();
      return { rows: fetched.rows, index: fetched.index, fromCache: false, refreshFailed: false };
    }
    const saved = indexed(stored.savedAt, stored.rows);
    const age = now() - stored.savedAt;
    const tooOld = !(age >= 0 && age < EXERCISE_INDEX_TTL_MS);
    fetchAndSave().then(
      ({ rows, index, changed, stillMine }) => {
        if (stillMine && changed) onUpdate?.({ rows, index, fromCache: false, refreshFailed: false });
      },
      () => {
        if (tooOld) onUpdate?.({ rows: saved.rows, index: saved.index, fromCache: true, refreshFailed: true });
      },
    );
    return { rows: saved.rows, index: saved.index, fromCache: true, refreshFailed: false };
  };
}
