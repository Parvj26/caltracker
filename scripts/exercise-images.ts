// The exercise picture manifest (which source picture each library exercise uses, under which licence, with a
// sha256 of the exact source file) and the processing applied at import time: a WebP of at most 1600 px on the long
// edge plus a 320 px thumbnail, the same sizes and format the apps use for chat and community photos.
//
// The processed pictures (~80 MB) are not committed. The import downloads each source file from the pinned
// free-exercise-db commit, checks its sha256 against this manifest, and only then processes and uploads it.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FULL_MAX_EDGE, THUMB_MAX_EDGE } from '@caltracker/shared';

/** WebP quality, as in the apps' on-device compression (0.8). */
export const WEBP_QUALITY = 80;

export interface ManifestImage {
  /** Path inside the source repo's `exercises/` folder, e.g. `Plank/0.jpg`. */
  path: string;
  sha256: string;
  licence: string;
}

export interface ManifestEntry {
  match: 'own' | 'exact' | 'alias';
  /** The source exercise whose pictures are used. */
  sourceId: string;
  images: ManifestImage[];
}

export interface ImageManifest {
  source: {
    name: string;
    repo: string;
    commit: string;
    licence: string;
    licenceFile: string;
  };
  /** Library exercise id (exercises.external_id) -> its pictures. Exercises without a match are absent. */
  exercises: Record<string, ManifestEntry>;
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Throws a clear error on the first problem. */
export function validateManifest(raw: unknown): ImageManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('Image manifest must be an object');
  const m = raw as Partial<ImageManifest>;
  const s = m.source;
  if (!s || !COMMIT.test(String(s.commit))) throw new Error('Image manifest: source.commit must be a full commit SHA');
  if (!s.licence || !s.licenceFile || !s.repo) throw new Error('Image manifest: source needs repo, licence and licenceFile');
  if (typeof m.exercises !== 'object' || m.exercises === null) throw new Error('Image manifest: missing exercises');
  for (const [id, e] of Object.entries(m.exercises)) {
    if (!['own', 'exact', 'alias'].includes(e.match)) throw new Error(`Image manifest ${id}: bad match kind`);
    if (!Array.isArray(e.images) || e.images.length === 0) throw new Error(`Image manifest ${id}: no images`);
    for (const img of e.images) {
      if (!SHA256.test(String(img.sha256))) throw new Error(`Image manifest ${id}: bad sha256 for ${img.path}`);
      if (!img.licence) throw new Error(`Image manifest ${id}: no licence for ${img.path}`);
    }
  }
  return m as ImageManifest;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_FILE = path.join(here, 'exercise-images-manifest.json');

export async function loadManifest(file: string = MANIFEST_FILE): Promise<ImageManifest> {
  return validateManifest(JSON.parse(await readFile(file, 'utf8')));
}

/** Throws unless the bytes are exactly the file the manifest pinned. */
export function verifySha256(bytes: Uint8Array, expected: string, label: string): void {
  const actual = sha256Hex(bytes);
  if (actual !== expected) throw new Error(`sha256 mismatch for ${label}: expected ${expected}, got ${actual}`);
}

/** WebP at most 1600 px on the long edge and a 320 px thumbnail; never enlarged, EXIF orientation applied. */
export async function processExerciseImage(bytes: Uint8Array): Promise<{ full: Buffer; thumb: Buffer }> {
  const resize = (max: number) =>
    sharp(bytes, { failOn: 'error' })
      .rotate()
      .resize(max, max, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  const [full, thumb] = await Promise.all([resize(FULL_MAX_EDGE), resize(THUMB_MAX_EDGE)]);
  return { full, thumb };
}
