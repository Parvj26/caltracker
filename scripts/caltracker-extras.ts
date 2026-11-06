import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKING_TYPES, type FreeExercise, type TrackingType } from '@caltracker/shared';

/** Built-in exercises CalTracker adds on top of free-exercise-db. Same shape, plus an explicit tracking type. */
export interface ExtraExercise extends FreeExercise {
  trackingType: TrackingType;
}

/** Every extra id starts with this. free-exercise-db ids never contain a colon, so the two can never clash. */
export const EXTRA_ID_PREFIX = 'caltracker:';

// Same vocabulary free-exercise-db uses (checked against its full 876-exercise list).
export const MUSCLES = new Set([
  'abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings',
  'lats', 'lower back', 'middle back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps',
]);
export const CATEGORIES = new Set([
  'cardio', 'olympic weightlifting', 'plyometrics', 'powerlifting', 'strength', 'stretching', 'strongman',
]);
export const EQUIPMENT = new Set([
  'bands', 'barbell', 'body only', 'cable', 'dumbbell', 'e-z curl bar', 'exercise ball', 'foam roll',
  'kettlebells', 'machine', 'medicine ball', 'other',
]);

/** Throws a clear error on the first problem found. Pure; no I/O. */
export function validateExtras(list: unknown, freeIds: Iterable<string> = []): ExtraExercise[] {
  if (!Array.isArray(list)) throw new Error('Extra exercises file must be a JSON array');
  const free = new Set(freeIds);
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const raw of list as Partial<ExtraExercise>[]) {
    const id = String(raw.id);
    const fail = (msg: string): never => {
      throw new Error(`Extra exercise ${id}: ${msg}`);
    };
    if (typeof raw.id !== 'string' || !raw.id.startsWith(EXTRA_ID_PREFIX) || raw.id.length <= EXTRA_ID_PREFIX.length) {
      fail(`id must start with "${EXTRA_ID_PREFIX}"`);
    }
    if (free.has(id)) fail('id clashes with a free-exercise-db id');
    if (seenIds.has(id)) fail('duplicate id');
    seenIds.add(id);
    if (typeof raw.name !== 'string' || raw.name.trim() === '') fail('missing name');
    const name = raw.name!.toLowerCase();
    if (seenNames.has(name)) fail('duplicate name');
    seenNames.add(name);
    if (!TRACKING_TYPES.includes(raw.trackingType as TrackingType)) fail(`bad tracking type ${String(raw.trackingType)}`);
    if (!CATEGORIES.has(String(raw.category))) fail(`unknown category ${String(raw.category)}`);
    if (raw.equipment !== null && !EQUIPMENT.has(String(raw.equipment))) fail(`unknown equipment ${String(raw.equipment)}`);
    if (!Array.isArray(raw.primaryMuscles) || raw.primaryMuscles.length === 0) fail('needs a primary muscle');
    for (const m of [...(raw.primaryMuscles ?? []), ...(raw.secondaryMuscles ?? [])]) {
      if (!MUSCLES.has(m)) fail(`unknown muscle "${m}"`);
    }
    if (!Array.isArray(raw.instructions) || raw.instructions.length < 3 || raw.instructions.length > 5) {
      fail('needs 3 to 5 instructions');
    }
    if (!Array.isArray(raw.images) || raw.images.length !== 0) fail('extras must not have images');
  }
  return list as ExtraExercise[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadExtras(freeIds: Iterable<string>, file?: string): Promise<ExtraExercise[]> {
  const raw: unknown = JSON.parse(await readFile(file ?? path.join(here, 'caltracker-extra-exercises.json'), 'utf8'));
  return validateExtras(raw, freeIds);
}
