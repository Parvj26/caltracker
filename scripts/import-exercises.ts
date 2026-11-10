import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadExtras } from './caltracker-extras';
import { loadManifest, processExerciseImage, verifySha256, type ImageManifest, type ManifestImage } from './exercise-images';
import {
  LIBRARY_TRACKING_TYPES,
  exerciseImageObjectPath,
  mapFreeExercise,
  thumbPathOf,
  type Database,
  type FreeExercise,
  type LibraryTrackingType,
} from '@caltracker/shared';

type Admin = SupabaseClient<Database>;

// free-exercise-db is released under the Unlicense (public domain); verified at this commit (LICENSE.md).
// Changing it means re-running build-exercise-image-manifest.ts: the import refuses a manifest for another commit.
export const PINNED_SHA = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const RAW_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db';
const BUCKET = 'exercise-images';
const BATCH_SIZE = 200;
const IMAGE_CONCURRENCY = 8;

export interface ImportOptions {
  /** Local directory holding exercises.json and the image files; omit to download from GitHub. */
  fixtureDir?: string;
  /** Override of the raw.githubusercontent.com base (tests). */
  rawBase?: string;
  /** Override of the CalTracker extras JSON file (tests). */
  extrasFile?: string;
  /** Override of the picture manifest (tests). */
  manifestFile?: string;
  log?: (line: string) => void;
}

export interface ImportSummary {
  exercises: number;
  extras: number;
  imagesUploaded: number;
  imagesSkipped: number;
  imagesFailed: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadOverrides(): Promise<Record<string, LibraryTrackingType>> {
  const raw: unknown = JSON.parse(
    await readFile(path.join(here, 'exercise-tracking-overrides.json'), 'utf8'),
  );
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid overrides file');
  const out: Record<string, LibraryTrackingType> = {};
  for (const [id, value] of Object.entries(raw)) {
    const t = LIBRARY_TRACKING_TYPES.find((x) => x === value);
    if (!t) throw new Error(`Invalid tracking type for ${id}: ${String(value)}`);
    out[id] = t;
  }
  return out;
}

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || res.status === 404) return res;
      last = new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/** The manifest's pictures for one exercise, or none when its source exercise is not part of this import. */
function picturesFor(manifest: ImageManifest, id: string, available: Set<string>): ManifestImage[] {
  const entry = manifest.exercises[id];
  return entry && available.has(entry.sourceId) ? entry.images : [];
}

export async function importExercises(admin: Admin, opts: ImportOptions = {}): Promise<ImportSummary> {
  const log = opts.log ?? console.log;
  const base = `${opts.rawBase ?? RAW_BASE}/${PINNED_SHA}`;
  const manifest = await loadManifest(opts.manifestFile);
  if (manifest.source.commit !== PINNED_SHA) {
    throw new Error(`Image manifest is for ${manifest.source.commit}, but the import is pinned to ${PINNED_SHA}`);
  }

  // 1. Load the exercise list.
  let list: FreeExercise[];
  if (opts.fixtureDir) {
    list = JSON.parse(await readFile(path.join(opts.fixtureDir, 'exercises.json'), 'utf8')) as FreeExercise[];
    log(`Read ${list.length} exercises from fixture ${opts.fixtureDir}`);
  } else {
    const res = await fetchOk(`${base}/dist/exercises.json`);
    if (!res.ok) throw new Error(`Could not download exercises.json (HTTP ${res.status})`);
    list = (await res.json()) as FreeExercise[];
    log(`Downloaded ${list.length} exercises (free-exercise-db @ ${PINNED_SHA.slice(0, 7)})`);
  }

  // 2. Build every row before writing anything. CalTracker's extras are validated here too.
  const overrides = await loadOverrides();
  const extras = await loadExtras(list.map((e) => e.id), opts.extrasFile);
  const available = new Set(list.map((e) => e.id));
  const pictures = new Map<string, ManifestImage[]>();
  for (const e of list) {
    // An exercise with its own photos must use exactly those; anything else means the manifest is stale.
    const entry = manifest.exercises[e.id];
    if (e.images.length > 0 && (entry?.match !== 'own' || entry.images.map((i) => i.path).join('\n') !== e.images.join('\n'))) {
      throw new Error(`Image manifest is out of date for ${e.id}; re-run build-exercise-image-manifest.ts`);
    }
    pictures.set(e.id, picturesFor(manifest, e.id, available));
  }
  for (const e of extras) pictures.set(e.id, picturesFor(manifest, e.id, available));

  // 3. Upload each source picture once (several exercises can share one): checked against its pinned sha256, then
  //    stored as a WebP of at most 1600 px plus a 320 px thumbnail. Pictures already in the bucket are skipped.
  const sources = new Map<string, ManifestImage>();
  for (const imgs of pictures.values()) for (const img of imgs) sources.set(img.path, img);
  const summary: ImportSummary = { exercises: list.length, extras: extras.length, imagesUploaded: 0, imagesSkipped: 0, imagesFailed: 0 };
  const failed = new Set<string>();
  const bucket = admin.storage.from(BUCKET);
  const exists = async (objectPath: string) => (await fetch(bucket.getPublicUrl(objectPath).data.publicUrl, { method: 'HEAD' })).ok;
  let done = 0;
  await runPool([...sources.values()], IMAGE_CONCURRENCY, async (image) => {
    const full = exerciseImageObjectPath(image.path);
    const thumb = thumbPathOf(full);
    try {
      if ((await exists(full)) && (await exists(thumb))) {
        summary.imagesSkipped++;
      } else {
        let bytes: Uint8Array;
        if (opts.fixtureDir) {
          bytes = await readFile(path.join(opts.fixtureDir, image.path));
        } else {
          const res = await fetchOk(`${base}/exercises/${image.path}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        verifySha256(bytes, image.sha256, image.path);
        const out = await processExerciseImage(bytes);
        for (const [objectPath, body] of [[full, out.full], [thumb, out.thumb]] as const) {
          const { error } = await bucket.upload(objectPath, body, { contentType: 'image/webp', upsert: true });
          if (error) throw error;
        }
        summary.imagesUploaded++;
      }
    } catch (e) {
      summary.imagesFailed++;
      failed.add(image.path);
      log(`FAILED image ${image.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    done++;
    if (done % 100 === 0 || done === sources.size) log(`Images ${done}/${sources.size}`);
  });

  // 4. Upsert exercises by external_id, pointing only at pictures that are in the bucket.
  const imagePaths = (id: string) =>
    (pictures.get(id) ?? []).filter((i) => !failed.has(i.path)).map((i) => exerciseImageObjectPath(i.path));
  const rows = list.map((e) => ({ ...mapFreeExercise(e, overrides), image_paths: imagePaths(e.id) }));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await admin.from('exercises').upsert(batch, { onConflict: 'external_id' });
    if (error) throw new Error(`Upsert failed: ${error.message}`);
    log(`Upserted exercises ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  const extraRows = extras.map((e) => ({ ...mapFreeExercise(e, { [e.id]: e.trackingType }), image_paths: imagePaths(e.id) }));
  if (extraRows.length > 0) {
    const { error } = await admin.from('exercises').upsert(extraRows, { onConflict: 'external_id' });
    if (error) throw new Error(`Upsert of CalTracker extras failed: ${error.message}`);
  }
  log(`Upserted ${extraRows.length} CalTracker extra exercises`);

  const withPictures = [...rows, ...extraRows].filter((r) => r.image_paths.length > 0).length;
  log(
    `Done: ${summary.exercises} exercises + ${summary.extras} CalTracker extras (${withPictures} with pictures); images uploaded ` +
      `${summary.imagesUploaded}, skipped ${summary.imagesSkipped}, failed ${summary.imagesFailed}`,
  );
  return summary;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { fixture: { type: 'string' } } });
  const admin = createClient<Database>(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const summary = await importExercises(admin, values.fixture ? { fixtureDir: path.resolve(process.env.INIT_CWD ?? process.cwd(), values.fixture) } : {});
  if (summary.imagesFailed > 0) {
    throw new Error(`${summary.imagesFailed} images failed; re-run to retry (the import is idempotent).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
