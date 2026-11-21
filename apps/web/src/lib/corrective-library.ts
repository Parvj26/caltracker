import {
  BUILTIN_CORRECTIVES,
  MUSCLE_GROUPS,
  muscleGroup,
  regionSides,
  smartFilter,
  toTrackingType,
  type CorrectiveChoice,
  type CorrectiveDirection,
  type MuscleId,
  type MuscleTag,
} from '@caltracker/shared';

/**
 * Library › Corrective › Exercises (board AS8): the coach's own corrective exercises ("Yours") and the built-in
 * defaults, merged, filtered and grouped by muscle. Pure functions, unit tested (corrective-library.test.ts).
 */

/** A coach row as the page loads it (corrective_exercises + its muscles + its exercise). */
export type CoachCorrectiveRow = {
  id: string;
  exercise_id: string;
  direction: string;
  default_sets: number;
  default_reps: number | null;
  default_seconds: number | null;
  each_side: boolean;
  muscles: readonly { muscle_id: string; side: string }[];
  exercise: { name: string; tracking_type: string; image_paths: readonly string[]; source: string } | null;
};

/** A built-in library exercise a built-in corrective may point at. */
export type BuiltinExerciseRow = { id: string; name: string; tracking_type: string; image_paths: readonly string[] };

export type LibraryItem = CorrectiveChoice & {
  /** Stable per item: `c:<corrective id>` (yours) or `b:<built-in key>`. */
  key: string;
  yours: boolean;
  /** The exercise is the coach's own (custom), so photos can be added to it. */
  custom: boolean;
  /** Its first photo in the exercise-images bucket (the page turns it into `imageUrl`). */
  imagePath: string | null;
};

const MUSCLE_ORDER = new Map(MUSCLE_GROUPS.map((m, i) => [m.id, i]));
const isMuscle = (id: string): id is MuscleId => MUSCLE_ORDER.has(id as MuscleId);
const sideOk = (s: string): s is MuscleTag['side'] => s === 'L' || s === 'R' || s === 'none';

/** Tags in catalogue order (top to bottom of the body), L before R. */
export function sortTags(tags: readonly MuscleTag[]): MuscleTag[] {
  const rank = { L: 0, R: 1, none: 2 } as const;
  return [...tags].sort((a, b) => (MUSCLE_ORDER.get(a.muscleId) ?? 99) - (MUSCLE_ORDER.get(b.muscleId) ?? 99) || rank[a.side] - rank[b.side]);
}

/** The coach's rows as library items (rows whose exercise is gone are left out). */
export function coachItems(rows: readonly CoachCorrectiveRow[]): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const r of rows) {
    if (!r.exercise || (r.direction !== 'under' && r.direction !== 'over')) continue;
    const muscles = sortTags(
      r.muscles.flatMap((m) => (isMuscle(m.muscle_id) && sideOk(m.side) ? [{ muscleId: m.muscle_id, side: m.side }] : [])),
    );
    out.push({
      key: `c:${r.id}`,
      yours: true,
      custom: r.exercise.source === 'custom',
      exerciseId: r.exercise_id,
      name: r.exercise.name,
      trackingType: toTrackingType(r.exercise.tracking_type),
      imagePath: r.exercise.image_paths[0] ?? null,
      imageUrl: null,
      direction: r.direction,
      muscles,
      dose: { sets: r.default_sets, reps: r.default_reps, seconds: r.default_seconds, eachSide: r.each_side },
      correctiveId: r.id,
      builtinKey: null,
      evidence: null,
    });
  }
  return out;
}

/** Every side a muscle group is kept on, as tags (both sides, or just 'none' for abs). */
export const bothSides = (id: MuscleId): MuscleTag[] => regionSides(id).map((side) => ({ muscleId: id, side }));

/**
 * The built-in defaults whose exercise is in the library, in BUILTIN_CORRECTIVES order. The exercise is found by name,
 * ignoring case (the first by id when two share a name). Built-ins tag a muscle on both sides.
 */
export function builtinItems(exercises: readonly BuiltinExerciseRow[]): LibraryItem[] {
  const byName = new Map<string, BuiltinExerciseRow>();
  for (const e of [...exercises].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const k = e.name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, e);
  }
  const out: LibraryItem[] = [];
  for (const b of BUILTIN_CORRECTIVES) {
    const e = byName.get(b.libraryName.toLowerCase());
    if (!e) continue;
    out.push({
      key: `b:${b.key}`,
      yours: false,
      custom: false,
      exerciseId: e.id,
      name: e.name,
      trackingType: toTrackingType(e.tracking_type),
      imagePath: e.image_paths[0] ?? null,
      imageUrl: null,
      direction: b.direction,
      muscles: b.muscles.flatMap(bothSides),
      dose: b.dose,
      correctiveId: null,
      builtinKey: b.key,
      evidence: b.evidence,
    });
  }
  return out;
}

/**
 * Yours first, then the built-ins. A built-in whose exercise the coach has tagged (in either direction) is left out:
 * the coach's row wins and the exercise shows once.
 */
export function mergeLibrary(coach: readonly LibraryItem[], builtins: readonly LibraryItem[]): LibraryItem[] {
  const taken = new Set(coach.map((c) => c.exerciseId));
  return [...coach, ...builtins.filter((b) => !taken.has(b.exerciseId))];
}

export type LibraryShow = 'all' | 'under' | 'over' | 'yours';
export type LibraryFilter = { query: string; show: LibraryShow; muscle: MuscleId | null };

/** The items matching the chips (All / Under / Over / Yours, a muscle) and the search (shared smart search). */
export function filterLibrary(items: readonly LibraryItem[], f: LibraryFilter): LibraryItem[] {
  const chipped = items.filter(
    (i) =>
      (f.show === 'all' || (f.show === 'yours' ? i.yours : i.direction === f.show)) &&
      (f.muscle === null || i.muscles.some((t) => t.muscleId === f.muscle)),
  );
  return smartFilter(chipped, f.query, (i) => i.name);
}

export type LibraryGroup = { muscleId: MuscleId; direction: CorrectiveDirection; items: LibraryItem[] };

/**
 * Grouped as on the board: one group per muscle and direction, Under groups first, then Over, each top to bottom of
 * the body; yours first inside a group. An item sits under its first muscle (top of the body), or under the muscle
 * being filtered on.
 */
export function groupLibrary(items: readonly LibraryItem[], muscle: MuscleId | null = null): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  for (const item of items) {
    const at = muscle ?? item.muscles[0]?.muscleId;
    if (!at) continue;
    const k = `${item.direction}.${at}`;
    let g = groups.get(k);
    if (!g) {
      g = { muscleId: at, direction: item.direction, items: [] };
      groups.set(k, g);
    }
    g.items.push(item);
  }
  const dir = { under: 0, over: 1 } as const;
  return [...groups.values()]
    .sort((a, b) => dir[a.direction] - dir[b.direction] || (MUSCLE_ORDER.get(a.muscleId) ?? 99) - (MUSCLE_ORDER.get(b.muscleId) ?? 99))
    .map((g) => ({ ...g, items: [...g.items.filter((i) => i.yours), ...g.items.filter((i) => !i.yours)] }));
}

/** The muscle groups any item is tagged to, top to bottom (the muscle filter's chips). */
export function libraryMuscles(items: readonly LibraryItem[]): MuscleId[] {
  const seen = new Set(items.flatMap((i) => i.muscles.map((t) => t.muscleId)));
  return MUSCLE_GROUPS.map((m) => m.id).filter((id): id is MuscleId => isMuscle(id) && seen.has(id));
}

/** Tags per muscle: [{ muscleId, sides }], top to bottom. */
export function tagsByMuscle(tags: readonly MuscleTag[]): { muscleId: MuscleId; sides: MuscleTag['side'][] }[] {
  const out: { muscleId: MuscleId; sides: MuscleTag['side'][] }[] = [];
  for (const t of sortTags(tags)) {
    const last = out[out.length - 1];
    if (last && last.muscleId === t.muscleId) last.sides.push(t.side);
    else out.push({ muscleId: t.muscleId, sides: [t.side] });
  }
  return out;
}

/** "Glute medius · L R", "Abs", "Calves · R". */
export function muscleTagLabel(muscleId: MuscleId, sides: readonly MuscleTag['side'][]): string {
  const name = muscleGroup(muscleId)?.name ?? muscleId;
  const lr = sides.filter((s) => s !== 'none');
  return lr.length === 0 ? name : `${name} · ${lr.join(' ')}`;
}

/** Turns one muscle group's side on or off in a tag list ('none' for abs). */
export function toggleTag(tags: readonly MuscleTag[], muscleId: MuscleId, side: MuscleTag['side']): MuscleTag[] {
  const on = tags.some((t) => t.muscleId === muscleId && t.side === side);
  return on ? tags.filter((t) => !(t.muscleId === muscleId && t.side === side)) : sortTags([...tags, { muscleId, side }]);
}

/** The storage path of a coach's photo for their own exercise (the bucket's policies only allow this shape). */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function exercisePhotoPath(workspaceId: string, exerciseId: string, fileId: string, ext: 'webp' | 'jpg'): string {
  return `custom/${workspaceId}/${exerciseId}/${fileId}.${ext}`;
}
/** True when `path` is a photo of this workspace's exercise (custom/<ws>/<exercise>/<uuid>.webp|jpg). */
export function isExercisePhotoPath(path: string, workspaceId: string, exerciseId: string): boolean {
  const re = new RegExp(`^custom/${UUID}/${UUID}/${UUID}\\.(webp|jpg)$`);
  return re.test(path) && path.startsWith(`custom/${workspaceId.toLowerCase()}/${exerciseId.toLowerCase()}/`);
}
export const MAX_EXERCISE_PHOTOS = 2;
