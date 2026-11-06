// Exercise details (photos, muscles, equipment, instructions, demo link) for the logging screen's thumbnails and
// info sheet. Loaded on demand by exercise id and kept twice: in memory for this session and in AsyncStorage so
// an exercise seen once still opens with no signal. Storage and the server call are injected, so tests need neither.
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
  /** The coach's pinned demo link, else the exercise's own, else null. */
  videoUrl: string | null;
};

export const DETAIL_KEY_PREFIX = 'caltracker.exerciseDetail.';

export type DetailCache = {
  /** What is already in memory for this exercise, for the first paint. */
  peek(id: string): ExerciseDetail | undefined;
  /**
   * Details for these ids. Ids already in memory are not fetched again. The rest come from the server; if the
   * server can't be reached they come from the phone's storage instead. Ids found nowhere are left out.
   */
  load(ids: readonly string[]): Promise<Record<string, ExerciseDetail>>;
};

function isDetail(v: unknown): v is ExerciseDetail {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    strings(d.imagePaths) &&
    strings(d.primaryMuscles) &&
    strings(d.secondaryMuscles) &&
    strings(d.instructions) &&
    (d.equipment === null || typeof d.equipment === 'string') &&
    (d.videoUrl === null || typeof d.videoUrl === 'string')
  );
}

export function createDetailCache(
  storage: KeyValueStorage,
  fetchRemote: (ids: string[]) => Promise<ExerciseDetail[]>,
): DetailCache {
  const memory = new Map<string, ExerciseDetail>();

  async function fromStorage(id: string): Promise<ExerciseDetail | null> {
    try {
      const raw = await storage.getItem(DETAIL_KEY_PREFIX + id);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return isDetail(parsed) ? parsed : null;
    } catch {
      return null; // unreadable storage is the same as nothing stored
    }
  }

  return {
    peek: (id) => memory.get(id),
    async load(ids) {
      const wanted = [...new Set(ids)];
      const missing = wanted.filter((id) => !memory.has(id));
      if (missing.length > 0) {
        try {
          const fresh = await fetchRemote(missing);
          for (const d of fresh) {
            memory.set(d.id, d);
            storage.setItem(DETAIL_KEY_PREFIX + d.id, JSON.stringify(d)).catch(() => undefined); // best effort
          }
        } catch {
          for (const id of missing) {
            const stored = await fromStorage(id);
            if (stored) memory.set(id, stored);
          }
        }
      }
      const out: Record<string, ExerciseDetail> = {};
      for (const id of wanted) {
        const d = memory.get(id);
        if (d) out[id] = d;
      }
      return out;
    },
  };
}
