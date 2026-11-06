// Exercise details (photos, muscles, equipment, instructions, demo link) for the logging screen's thumbnails and
// info sheet. Loaded on demand by exercise id and kept twice: in memory for this session and in AsyncStorage so
// an exercise seen once still opens with no signal. Storage and the server call are injected, so tests need neither.
//
// One cache per signed-in user: the storage keys carry the user id, and the app makes a new cache when the user
// changes, so a coach's pinned link or a custom exercise seen by one account is never shown to another on the
// same phone. Each entry remembers when it was fetched and is fetched again after 24 hours (a stale copy is
// still used when the server can't be reached). At most 200 entries are kept; the oldest go first.
import { demoUrl } from './demo-link';
import type { KeyValueStorage } from './log-store';

export type ExerciseDetail = {
  id: string;
  name: string;
  /** Storage paths in the exercise-images bucket: the start photo first, then the end photo. */
  imagePaths: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string | null;
  instructions: string[];
  /** A canonical YouTube watch link (the coach's pinned one, else the exercise's own), or null. */
  videoUrl: string | null;
};

export const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
export const DETAIL_MAX_ENTRIES = 200;

const prefix = (userId: string) => `caltracker.exerciseDetail.${userId}.`;
/** Where one exercise's entry is stored for this user. */
export const detailKey = (userId: string, id: string) => `${prefix(userId)}${id}`;
/** The list of stored entries with their fetch times, for expiry and the size cap. */
export const detailIndexKey = (userId: string) => `${prefix(userId)}index`;

type Entry = { savedAt: number; detail: ExerciseDetail };
type IndexRow = { id: string; at: number };

export type DetailCache = {
  /** What is already in memory for this exercise, for the first paint (however old). */
  peek(id: string): ExerciseDetail | undefined;
  /**
   * Details for these ids. Ids fetched in the last 24 hours are not fetched again. The rest come from the server;
   * if the server can't be reached they come from memory or the phone's storage, however old. Ids found nowhere
   * are left out.
   */
  load(ids: readonly string[]): Promise<Record<string, ExerciseDetail>>;
};

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** A detail with its demo link re-checked; null if the value isn't a detail at all. */
function toDetail(v: unknown): ExerciseDetail | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  if (
    typeof d.id !== 'string' ||
    typeof d.name !== 'string' ||
    !isStrings(d.imagePaths) ||
    !isStrings(d.primaryMuscles) ||
    !isStrings(d.secondaryMuscles) ||
    !isStrings(d.instructions) ||
    !(d.equipment === null || typeof d.equipment === 'string') ||
    !(d.videoUrl === null || typeof d.videoUrl === 'string')
  ) {
    return null;
  }
  return {
    id: d.id,
    name: d.name,
    imagePaths: d.imagePaths,
    primaryMuscles: d.primaryMuscles,
    secondaryMuscles: d.secondaryMuscles,
    equipment: d.equipment,
    instructions: d.instructions,
    videoUrl: demoUrl(d.videoUrl),
  };
}

export function createDetailCache(
  storage: KeyValueStorage,
  fetchRemote: (ids: string[]) => Promise<ExerciseDetail[]>,
  userId: string,
  now: () => number = Date.now,
): DetailCache {
  const memory = new Map<string, Entry>();
  // Storage writes run one after another, so two loads can't overwrite each other's index.
  let writes: Promise<void> = Promise.resolve();

  async function fromStorage(id: string): Promise<Entry | null> {
    try {
      const raw = await storage.getItem(detailKey(userId, id));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as { savedAt?: unknown; detail?: unknown };
      const detail = toDetail(parsed.detail);
      return detail && typeof parsed.savedAt === 'number' ? { savedAt: parsed.savedAt, detail } : null;
    } catch {
      return null; // unreadable storage is the same as nothing stored
    }
  }

  async function readIndex(): Promise<IndexRow[]> {
    try {
      const raw = await storage.getItem(detailIndexKey(userId));
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return (parsed as Partial<IndexRow>[]).filter(
        (r): r is IndexRow => typeof r === 'object' && r !== null && typeof r.id === 'string' && typeof r.at === 'number',
      );
    } catch {
      return [];
    }
  }

  function persist(fresh: Entry[]): Promise<void> {
    writes = writes.then(async () => {
      try {
        const index = new Map((await readIndex()).map((r) => [r.id, r.at]));
        for (const e of fresh) {
          await storage.setItem(detailKey(userId, e.detail.id), JSON.stringify(e));
          index.set(e.detail.id, e.savedAt);
        }
        const rows = [...index].map(([id, at]) => ({ id, at })).sort((a, b) => b.at - a.at);
        for (const old of rows.slice(DETAIL_MAX_ENTRIES)) {
          await storage.removeItem(detailKey(userId, old.id));
          memory.delete(old.id);
        }
        await storage.setItem(detailIndexKey(userId), JSON.stringify(rows.slice(0, DETAIL_MAX_ENTRIES)));
      } catch {
        // best effort: the memory copy still works this session
      }
    });
    return writes;
  }

  return {
    peek: (id) => memory.get(id)?.detail,
    async load(ids) {
      const wanted = [...new Set(ids)];
      const stale = wanted.filter((id) => {
        const e = memory.get(id);
        return !e || now() - e.savedAt > DETAIL_TTL_MS;
      });
      if (stale.length > 0) {
        try {
          const fresh: Entry[] = [];
          for (const raw of await fetchRemote(stale)) {
            const detail = toDetail(raw);
            if (!detail) continue;
            const entry = { savedAt: now(), detail };
            memory.set(detail.id, entry);
            fresh.push(entry);
          }
          await persist(fresh);
        } catch {
          for (const id of stale) {
            if (memory.has(id)) continue; // an old copy in memory beats nothing
            const stored = await fromStorage(id);
            if (stored) memory.set(id, stored);
          }
        }
      }
      const out: Record<string, ExerciseDetail> = {};
      for (const id of wanted) {
        const e = memory.get(id);
        if (e) out[id] = e.detail;
      }
      return out;
    },
  };
}
