import { readFile } from 'node:fs/promises';
import { thumbPathOf } from '@caltracker/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadExtras } from './caltracker-extras';
import { folderFor, loadOwnImages, ownImageFiles, ownImageObjectPaths, validateOwnImages } from './caltracker-exercise-images';
import { loadManifest } from './exercise-images';

const good = { licence: 'Owned', exercises: { 'caltracker:burpee': { name: 'Burpee', folder: 'burpee' } } };

describe('validateOwnImages', () => {
  it('accepts a good table', () => {
    expect(validateOwnImages(good).exercises['caltracker:burpee']?.folder).toBe('burpee');
  });

  it('rejects a missing licence, a bad folder and a folder used twice', () => {
    expect(() => validateOwnImages({ ...good, licence: '' })).toThrow(/licence/);
    expect(() => validateOwnImages({ ...good, exercises: { a: { name: 'A', folder: '../x' } } })).toThrow(/bad folder/);
    expect(() =>
      validateOwnImages({ ...good, exercises: { a: { name: 'A', folder: 'x' }, b: { name: 'B', folder: 'x' } } }),
    ).toThrow(/used twice/);
  });
});

describe('ownImageObjectPaths', () => {
  it('puts the start and end picture under caltracker/<folder>/, each with a thumbnail file', () => {
    const paths = ownImageObjectPaths({ name: 'Burpee', folder: 'burpee' });
    expect(paths).toEqual(['caltracker/burpee/0.webp', 'caltracker/burpee/1.webp']);
    expect(ownImageFiles(paths[0]!, '/d')).toEqual([
      ['caltracker/burpee/0.webp', '/d/burpee/0.webp'],
      ['caltracker/burpee/0-thumb.webp', '/d/burpee/0-thumb.webp'],
    ]);
  });
});

describe('caltracker-exercise-images.json', () => {
  it('names real exercises that have no free-exercise-db picture, with matching folders', async () => {
    const table = await loadOwnImages();
    const extras = await loadExtras([]);
    const manifest = await loadManifest();
    for (const [id, entry] of Object.entries(table.exercises)) {
      expect(entry.folder).toBe(folderFor(entry.name));
      expect(manifest.exercises[id], `${id} also has free-exercise-db pictures`).toBeUndefined();
      if (id.startsWith('caltracker:')) expect(extras.find((e) => e.id === id)?.name).toBe(entry.name);
    }
  });

  it('has every committed picture as a WebP of at most 1600 px with a 320 px thumbnail', async () => {
    const table = await loadOwnImages();
    for (const entry of Object.values(table.exercises)) {
      for (const objectPath of ownImageObjectPaths(entry)) {
        const [[, full], [thumbPath, thumb]] = ownImageFiles(objectPath) as [[string, string], [string, string]];
        expect(thumbPath).toBe(thumbPathOf(objectPath));
        const f = await sharp(await readFile(full)).metadata();
        const t = await sharp(await readFile(thumb)).metadata();
        expect(f.format).toBe('webp');
        expect(t.format).toBe('webp');
        expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(1600);
        expect(Math.max(t.width, t.height)).toBe(320);
      }
    }
  });
});
