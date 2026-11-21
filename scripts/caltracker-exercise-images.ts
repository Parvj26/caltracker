// Pictures CalTracker owns (illustrations made for the product) for built-in exercises that have no
// free-exercise-db photo. They are committed, already processed, under exercise-images/caltracker/<folder>/:
// 0.webp (start) and 1.webp (end), each with its -thumb.webp, the same sizes the import makes from free-exercise-db
// photos. import-exercises.ts uploads them to the exercise-images bucket at caltracker/<folder>/... .
//
// To add or replace pictures: put "NNA <Exercise Name>.png" (start) and "NNB <Exercise Name>.png" (end) in a folder,
// add the exercise to caltracker-exercise-images.json, then run
//   pnpm --filter @caltracker/scripts exec tsx caltracker-exercise-images.ts <png-folder>
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { thumbPathOf } from '@caltracker/shared';
import { processExerciseImage } from './exercise-images';

/** Bucket folder of CalTracker's own pictures; free-exercise-db photos live under free-exercise-db/. */
export const OWN_IMAGE_PREFIX = 'caltracker/';
/** Start then end picture, as for free-exercise-db exercises. */
export const OWN_IMAGE_FILES = ['0.webp', '1.webp'] as const;

const here = path.dirname(fileURLToPath(import.meta.url));
export const OWN_IMAGES_FILE = path.join(here, 'caltracker-exercise-images.json');
export const OWN_IMAGES_DIR = path.join(here, 'exercise-images', 'caltracker');

export interface OwnImageEntry {
  /** Exact name of the built-in exercise; used to find the source drawings. */
  name: string;
  /** Folder under exercise-images/caltracker/ and under caltracker/ in the bucket. */
  folder: string;
}

export interface OwnImageTable {
  licence: string;
  /** Exercise id (exercises.external_id) -> its pictures. */
  exercises: Record<string, OwnImageEntry>;
}

const FOLDER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The folder name for an exercise name: "Kettlebell Halo" -> "kettlebell-halo". */
export function folderFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Throws a clear error on the first problem. Pure; no I/O. */
export function validateOwnImages(raw: unknown): OwnImageTable {
  if (typeof raw !== 'object' || raw === null) throw new Error('Own exercise pictures file must be an object');
  const t = raw as Partial<OwnImageTable>;
  if (typeof t.licence !== 'string' || t.licence.trim() === '') throw new Error('Own exercise pictures: missing licence');
  if (typeof t.exercises !== 'object' || t.exercises === null) throw new Error('Own exercise pictures: missing exercises');
  const folders = new Set<string>();
  for (const [id, e] of Object.entries(t.exercises)) {
    if (typeof e.name !== 'string' || e.name.trim() === '') throw new Error(`Own exercise pictures ${id}: missing name`);
    if (!FOLDER.test(String(e.folder))) throw new Error(`Own exercise pictures ${id}: bad folder ${String(e.folder)}`);
    if (folders.has(e.folder)) throw new Error(`Own exercise pictures ${id}: folder ${e.folder} used twice`);
    folders.add(e.folder);
  }
  return t as OwnImageTable;
}

export async function loadOwnImages(file: string = OWN_IMAGES_FILE): Promise<OwnImageTable> {
  return validateOwnImages(JSON.parse(await readFile(file, 'utf8')));
}

/** Bucket paths of an exercise's own pictures (start, end), e.g. caltracker/burpee/0.webp. */
export function ownImageObjectPaths(entry: OwnImageEntry): string[] {
  return OWN_IMAGE_FILES.map((f) => `${OWN_IMAGE_PREFIX}${entry.folder}/${f}`);
}

/** Every committed file behind a bucket path: the picture and its thumbnail, as [bucket path, local file]. */
export function ownImageFiles(objectPath: string, dir: string = OWN_IMAGES_DIR): [string, string][] {
  return [objectPath, thumbPathOf(objectPath)].map((p) => [p, path.join(dir, p.slice(OWN_IMAGE_PREFIX.length))]);
}

async function main(): Promise<void> {
  const src = process.argv[2];
  if (!src) throw new Error('Usage: caltracker-exercise-images.ts <folder of "NNA <Name>.png" / "NNB <Name>.png">');
  const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), src);
  const files = await readdir(dir);
  const table = await loadOwnImages();
  for (const entry of Object.values(table.exercises)) {
    const out = path.join(OWN_IMAGES_DIR, entry.folder);
    await mkdir(out, { recursive: true });
    for (const [i, letter] of ['A', 'B'].entries()) {
      const matches = files.filter((f) => f === `${f.slice(0, 2)}${letter} ${entry.name}.png` && /^\d\d$/.test(f.slice(0, 2)));
      if (matches.length !== 1) throw new Error(`Expected one "NN${letter} ${entry.name}.png", found ${matches.length}`);
      const { full, thumb } = await processExerciseImage(await readFile(path.join(dir, matches[0]!)));
      await writeFile(path.join(out, `${i}.webp`), full);
      await writeFile(path.join(out, `${i}-thumb.webp`), thumb);
    }
  }
  console.log(`Wrote pictures for ${Object.keys(table.exercises).length} exercises to ${OWN_IMAGES_DIR}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
