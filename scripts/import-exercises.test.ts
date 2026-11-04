import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { Database, FreeExercise } from '@caltracker/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PINNED_SHA, importExercises } from './import-exercises';

const admin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'free-exercise-db');
const quiet = () => undefined;

let subsetDir: string;
let subset: FreeExercise[];
let server: Server;

beforeAll(async () => {
  const all = JSON.parse(await readFile(path.join(fixtureDir, 'exercises.json'), 'utf8')) as FreeExercise[];
  subset = all.filter((e) => ['Barbell_Squat', 'Plank', 'Rope_Jumping'].includes(e.id));
  expect(subset).toHaveLength(3);
  subsetDir = await mkdtemp(path.join(os.tmpdir(), 'fedb-'));
  await writeFile(path.join(subsetDir, 'exercises.json'), JSON.stringify(subset));
  for (const e of subset) await cp(path.join(fixtureDir, e.id), path.join(subsetDir, e.id), { recursive: true });

  // Mimics raw.githubusercontent.com for the pinned commit.
  server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '');
    const prefix = `/${PINNED_SHA}/`;
    if (!url.startsWith(prefix)) return void res.writeHead(404).end();
    const rel = url.slice(prefix.length);
    const file = rel === 'dist/exercises.json' ? 'exercises.json' : rel.replace(/^exercises\//, '');
    readFile(path.join(subsetDir, file)).then(
      (b) => res.writeHead(200).end(b),
      () => res.writeHead(404).end(),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});

afterAll(async () => {
  server?.close();
  if (subsetDir) await rm(subsetDir, { recursive: true, force: true });
});

async function state() {
  const ids = subset.map((e) => e.id);
  const { data, error } = await admin
    .from('exercises')
    .select('external_id, source, workspace_id, tracking_type')
    .in('external_id', ids);
  expect(error).toBeNull();
  let objects = 0;
  for (const id of ids) {
    const { data: files } = await admin.storage.from('exercise-images').list(`free-exercise-db/${id}`);
    objects += files?.length ?? 0;
  }
  return { rows: data ?? [], objects };
}

const imageCount = () => subset.reduce((n, e) => n + e.images.length, 0);

describe('importExercises', () => {
  it('imports from --fixture twice without duplicates', async () => {
    const first = await importExercises(admin, { fixtureDir: subsetDir, log: quiet });
    const second = await importExercises(admin, { fixtureDir: subsetDir, log: quiet });
    expect(first.exercises).toBe(3);
    expect(first.imagesFailed + second.imagesFailed).toBe(0);
    expect(second.imagesUploaded).toBe(0);
    expect(second.imagesSkipped).toBe(imageCount());

    const { rows, objects } = await state();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === 'builtin' && r.workspace_id === null)).toBe(true);
    expect(objects).toBe(imageCount());
  });

  it('applies tracking overrides', async () => {
    const { rows } = await state();
    expect(rows.find((r) => r.external_id === 'Plank')?.tracking_type).toBe('time');
    expect(rows.find((r) => r.external_id === 'Rope_Jumping')?.tracking_type).toBe('time');
  });

  it('downloads from the (stubbed) GitHub host', async () => {
    const { port } = server.address() as AddressInfo;
    const summary = await importExercises(admin, { rawBase: `http://127.0.0.1:${port}`, log: quiet });
    expect(summary.exercises).toBe(3);
    expect(summary.imagesFailed).toBe(0);
    const { rows, objects } = await state();
    expect(rows).toHaveLength(3);
    expect(objects).toBe(imageCount());
  });
});
