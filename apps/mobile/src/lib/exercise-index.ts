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

function isRow(r: unknown): r is ExerciseIndexRow {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Partial<ExerciseIndexRow>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    Array.isArray(o.primaryMuscles) &&
    Array.isArray(o.secondaryMuscles) &&
    typeof o.trackingType === 'string'
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

export function createExerciseIndexLoader(
  storage: KeyValueStorage,
  fetchRows: () => Promise<ExerciseIndexRow[]>,
  userId: string,
  now: () => number = Date.now,
): () => Promise<LoadedExerciseIndex> {
  const key = `${EXERCISE_INDEX_KEY}.${userId}`;
  let inFlight: Promise<LoadedExerciseIndex> | null = null;

  async function run(): Promise<LoadedExerciseIndex> {
    const stored = await readStored(storage, key);
    // A clock set back counts as stale rather than fresh forever.
    const age = stored ? now() - stored.savedAt : Infinity;
    if (stored && age >= 0 && age < EXERCISE_INDEX_TTL_MS) {
      return { rows: stored.rows, fromCache: true, refreshFailed: false };
    }
    try {
      const rows = await fetchRows();
      await storage.setItem(key, JSON.stringify({ savedAt: now(), rows })).catch(() => undefined);
      return { rows, fromCache: false, refreshFailed: false };
    } catch (e) {
      if (stored) return { rows: stored.rows, fromCache: true, refreshFailed: true };
      throw e;
    }
  }

  return () => {
    inFlight ??= run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
