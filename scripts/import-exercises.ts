import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadExtras } from './caltracker-extras';
import {
  FREE_EXERCISE_DB_IMAGE_PREFIX,
  TRACKING_TYPES,
  mapFreeExercise,
  type Database,
  type FreeExercise,
  type TrackingType,
} from '@caltracker/shared';

type Admin = SupabaseClient<Database>;

// free-exercise-db is released under the Unlicense (public domain); verified at this commit.
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

async function loadOverrides(): Promise<Record<string, TrackingType>> {
  const raw: unknown = JSON.parse(
    await readFile(path.join(here, 'exercise-tracking-overrides.json'), 'utf8'),
  );
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid overrides file');
  const out: Record<string, TrackingType> = {};
  for (const [id, value] of Object.entries(raw)) {
    const t = TRACKING_TYPES.find((x) => x === value);
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

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

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

export async function importExercises(admin: Admin, opts: ImportOptions = {}): Promise<ImportSummary> {
  const log = opts.log ?? console.log;
  const base = `${opts.rawBase ?? RAW_BASE}/${PINNED_SHA}`;

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

  // 2. Upsert exercises by external_id.
  const overrides = await loadOverrides();
  const rows = list.map((e) => mapFreeExercise(e, overrides));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await admin.from('exercises').upsert(batch, { onConflict: 'external_id' });
    if (error) throw new Error(`Upsert failed: ${error.message}`);
    log(`Upserted exercises ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  // 2b. CalTracker's own extras: validated first, upserted the same way, no images.
  const extras = await loadExtras(list.map((e) => e.id), opts.extrasFile);
  const extraRows = extras.map((e) => mapFreeExercise(e, { [e.id]: e.trackingType }));
  if (extraRows.length > 0) {
    const { error } = await admin.from('exercises').upsert(extraRows, { onConflict: 'external_id' });
    if (error) throw new Error(`Upsert of CalTracker extras failed: ${error.message}`);
  }
  log(`Upserted ${extraRows.length} CalTracker extra exercises`);

  // 3. Upload images, skipping those already in the bucket.
  const sources = list.flatMap((e) => e.images);
  const summary: ImportSummary = { exercises: rows.length, extras: extraRows.length, imagesUploaded: 0, imagesSkipped: 0, imagesFailed: 0 };
  let done = 0;
  await runPool(sources, IMAGE_CONCURRENCY, async (image) => {
    const objectPath = `${FREE_EXERCISE_DB_IMAGE_PREFIX}${image}`;
    try {
      const publicUrl = admin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
      const exists = await fetch(publicUrl, { method: 'HEAD' });
      if (exists.ok) {
        summary.imagesSkipped++;
      } else {
        let bytes: Uint8Array;
        if (opts.fixtureDir) {
          bytes = await readFile(path.join(opts.fixtureDir, image));
        } else {
          const res = await fetchOk(`${base}/exercises/${image}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        const { error } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
          contentType: CONTENT_TYPES[path.extname(image).toLowerCase()] ?? 'application/octet-stream',
          upsert: false,
        });
        if (error && !/already exists|Duplicate/i.test(error.message)) throw error;
        if (error) summary.imagesSkipped++;
        else summary.imagesUploaded++;
      }
    } catch (e) {
      summary.imagesFailed++;
      log(`FAILED image ${image}: ${e instanceof Error ? e.message : String(e)}`);
    }
    done++;
    if (done % 100 === 0 || done === sources.length) log(`Images ${done}/${sources.length}`);
  });

  log(
    `Done: ${summary.exercises} exercises + ${summary.extras} CalTracker extras; images uploaded ${summary.imagesUploaded}, ` +
      `skipped ${summary.imagesSkipped}, failed ${summary.imagesFailed}`,
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
