import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadExtras } from './caltracker-extras';
import { PINNED_SHA } from './import-exercises';
import { loadManifest, processExerciseImage, sha256Hex, validateManifest, verifySha256 } from './exercise-images';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'free-exercise-db', 'Barbell_Deadlift', '0.jpg');

const good = {
  source: { name: 'x', repo: 'https://github.com/a/b', commit: 'a'.repeat(40), licence: 'Unlicense', licenceFile: 'LICENSE.md' },
  exercises: { Plank: { match: 'own', sourceId: 'Plank', images: [{ path: 'Plank/0.jpg', sha256: 'b'.repeat(64), licence: 'Unlicense' }] } },
};

describe('processExerciseImage', () => {
  it('makes a WebP no larger than 1600 px and a 320 px WebP thumbnail', async () => {
    const { full, thumb } = await processExerciseImage(await readFile(fixture));
    const f = await sharp(full).metadata();
    const t = await sharp(thumb).metadata();
    expect(f.format).toBe('webp');
    expect(t.format).toBe('webp');
    expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(1600);
    expect(Math.max(t.width, t.height)).toBe(320);
  });

  it('shrinks a large picture to 1600 px on the long edge', async () => {
    const big = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const { full } = await processExerciseImage(big);
    const f = await sharp(full).metadata();
    expect([f.width, f.height]).toEqual([1600, 800]);
  });

  it('rejects bytes that are not a picture', async () => {
    await expect(processExerciseImage(new TextEncoder().encode('not an image'))).rejects.toThrow();
  });
});

describe('sha256 checks', () => {
  it('accepts the pinned bytes and refuses anything else', () => {
    const bytes = new TextEncoder().encode('hello');
    const sum = sha256Hex(bytes);
    expect(sum).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(() => verifySha256(bytes, sum, 'x')).not.toThrow();
    expect(() => verifySha256(new TextEncoder().encode('hellO'), sum, 'x')).toThrow(/sha256 mismatch/);
  });
});

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(good).exercises.Plank!.sourceId).toBe('Plank');
  });

  it('refuses a short commit, a bad hash or a missing licence', () => {
    expect(() => validateManifest({ ...good, source: { ...good.source, commit: 'main' } })).toThrow(/commit/);
    const badHash = structuredClone(good);
    badHash.exercises.Plank.images[0]!.sha256 = 'nope';
    expect(() => validateManifest(badHash)).toThrow(/sha256/);
    const noLicence = structuredClone(good);
    noLicence.exercises.Plank.images[0]!.licence = '';
    expect(() => validateManifest(noLicence)).toThrow(/licence/);
  });
});

describe('the committed manifest', () => {
  it('is pinned to the same commit as the import and covers the fixtures with matching hashes', async () => {
    const m = await loadManifest();
    expect(m.source.commit).toBe(PINNED_SHA);
    expect(m.source.licence).toBe('Unlicense');
    const deadlift = m.exercises.Barbell_Deadlift!;
    expect(deadlift.match).toBe('own');
    verifySha256(await readFile(fixture), deadlift.images[0]!.sha256, 'fixture');
  });

  it('only lists CalTracker extras that were matched on purpose', async () => {
    const m = await loadManifest();
    const extras = await loadExtras([]);
    for (const e of extras) {
      const entry = m.exercises[e.id];
      if (entry) expect(['exact', 'alias']).toContain(entry.match);
    }
  });
});
