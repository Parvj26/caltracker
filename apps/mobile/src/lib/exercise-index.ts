// The exercise library the phone searches while logging. Kept in AsyncStorage so "+ Exercise" works with no signal,
// and fetched again at most once every 24 hours. Storage and the server call are injected, so tests need neither.
// One copy per signed-in user (custom exercises belong to a workspace), keyed `caltracker.exerciseIndex.v1.<user id>`.
import type { ExerciseIndexRow } from '@caltracker/shared';
import type { KeyValueStorage } from './log-store';

export const EXERCISE_INDEX_KEY = 'caltracker.exerciseIndex.v1';
export const EXERCISE_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

export type LoadedExerciseIndex = {
  rows: ExerciseIndexRow[];
  /** True when the rows came from the phone's storage rather than a fresh fetch. */
  fromCache: boolean;
  /** True when a refresh was due but failed, so the saved library is being used ("Using saved library"). */
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
 * Returns the saved library at once, however old. A copy older than 24 hours (or one from a clock set back) is
 * refreshed in the background: `onUpdate` gets the new rows when they land, or the saved ones with
 * `refreshFailed` when the fetch fails. With nothing saved it waits for the fetch (and rejects if that fails).
 */
export function createExerciseIndexLoader(
  storage: KeyValueStorage,
  fetchRows: () => Promise<ExerciseIndexRow[]>,
  userId: string,
  now: () => number = Date.now,
): (onUpdate?: (next: LoadedExerciseIndex) => void) => Promise<LoadedExerciseIndex> {
  const key = `${EXERCISE_INDEX_KEY}.${userId}`;
  let inFlight: Promise<{ rows: ExerciseIndexRow[]; stillMine: boolean }> | null = null;
  const fetchAndSave = () => {
    inFlight ??= fetchRows()
      .then(async (rows) => {
        // The user may have signed out, or someone else signed in, while this was loading: then save nothing.
        const stillMine = (await storage.getItem(LAST_USER_KEY).catch(() => null)) === userId;
        if (stillMine) await storage.setItem(key, JSON.stringify({ savedAt: now(), rows })).catch(() => undefined);
        return { rows, stillMine };
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return async (onUpdate) => {
    const stored = await readStored(storage, key);
    if (!stored) {
      return { rows: (await fetchAndSave()).rows, fromCache: false, refreshFailed: false };
    }
    const age = now() - stored.savedAt;
    if (age >= 0 && age < EXERCISE_INDEX_TTL_MS) {
      return { rows: stored.rows, fromCache: true, refreshFailed: false };
    }
    fetchAndSave().then(
      ({ rows, stillMine }) => {
        if (stillMine) onUpdate?.({ rows, fromCache: false, refreshFailed: false });
      },
      () => onUpdate?.({ rows: stored.rows, fromCache: true, refreshFailed: true }),
    );
    return { rows: stored.rows, fromCache: true, refreshFailed: false };
  };
}
