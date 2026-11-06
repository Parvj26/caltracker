import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { STICKERS } from '@caltracker/shared';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assetMapSource,
  LOCKED_ALPHA,
  LOCKED_COLOUR,
  LOCKED_SIZE,
  LARGE_SIZE,
  processSticker,
  SMALL_SIZE,
} from './process-stickers';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stickers-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A 600x400 transparent PNG with an off-centre 200x100 red rectangle. */
async function fixture(name: string): Promise<string> {
  const file = path.join(dir, `${name}.png`);
  const rect = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rect, left: 20, top: 250 }])
    .png()
    .toFile(file);
  return file;
}

async function pixels(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe('processSticker', () => {
  it('writes the large, small and locked images into every output folder', async () => {
    const out1 = path.join(dir, 'out1');
    const out2 = path.join(dir, 'out2');
    const written = await processSticker(await fixture('red-panda'), [out1, out2]);
    expect(written.sort()).toEqual(['red-panda-locked.webp', 'red-panda-sm.webp', 'red-panda.webp']);
    for (const out of [out1, out2]) {
      for (const [file, size] of [
        ['red-panda.webp', LARGE_SIZE],
        ['red-panda-sm.webp', SMALL_SIZE],
        ['red-panda-locked.webp', LOCKED_SIZE],
      ] as const) {
        const m = await sharp(path.join(out, file)).metadata();
        expect([m.format, m.width, m.height, m.hasAlpha]).toEqual(['webp', size, size, true]);
      }
    }
  });

  it('trims the artwork, centres it and leaves 4% transparent padding', async () => {
    const out = path.join(dir, 'out');
    await processSticker(await fixture('cat'), [out]);
    const { data, width, height } = await pixels(path.join(out, 'cat.webp'));
    const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3] ?? 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alphaAt(x, y) > 128) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const pad = Math.round(LARGE_SIZE * 0.04);
    expect(minX).toBeGreaterThanOrEqual(pad - 2);
    expect(minX).toBeLessThanOrEqual(pad + 2); // the wide side touches the padding
    expect(width - 1 - maxX).toBeGreaterThanOrEqual(pad - 2);
    expect(Math.abs(minY - (height - 1 - maxY))).toBeLessThanOrEqual(2); // centred vertically
    expect(alphaAt(0, 0)).toBe(0);
  });

  it('makes the locked silhouette a single #121212 colour at 12% opacity', async () => {
    const out = path.join(dir, 'out');
    await processSticker(await fixture('okapi'), [out]);
    const { data, width, height } = await pixels(path.join(out, 'okapi-locked.webp'));
    const seen = new Set<string>();
    let maxAlpha = 0;
    for (let i = 0; i < width * height * 4; i += 4) {
      const a = data[i + 3] ?? 0;
      maxAlpha = Math.max(maxAlpha, a);
      if (a > 0) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    const [r, g, b] = [1, 3, 5].map((s) => parseInt(LOCKED_COLOUR.slice(s, s + 2), 16));
    expect([...seen]).toEqual([`${r},${g},${b}`]);
    expect(maxAlpha).toBe(Math.round(LOCKED_ALPHA * 255));
  });

  it('rejects an image without a transparent background', async () => {
    const file = path.join(dir, 'flat.png');
    await writeFile(file, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer());
    await expect(processSticker(file, [dir])).rejects.toThrow('needs a transparent background');
  });
});

describe('assetMapSource', () => {
  it('writes a generated header and a literal require for every size of every key', () => {
    const src = assetMapSource(['cat', 'red-panda']);
    expect(src).toMatch(/generated.*do not edit/i);
    expect(src).toContain("require('../../assets/stickers/red-panda-sm.webp')");
    expect(src).toContain("require('../../assets/stickers/cat-locked.webp')");
    expect(src).toContain("'red-panda': {");
  });
});

describe('committed sticker assets', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const dirs = ['apps/mobile/assets/stickers', 'apps/web/public/stickers'];

  it('cover every STICKERS key at every size, in the app and on the web', () => {
    expect(STICKERS).toHaveLength(60);
    const missing: string[] = [];
    for (const d of dirs) {
      for (const { key } of STICKERS) {
        for (const suffix of ['', '-sm', '-locked']) {
          const f = path.join(root, d, `${key}${suffix}.webp`);
          if (!existsSync(f)) missing.push(path.relative(root, f));
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has a generated asset map that mentions every STICKERS key', async () => {
    const src = await readFile(path.join(root, 'apps/mobile/src/lib/sticker-assets.ts'), 'utf8');
    for (const { key } of STICKERS) expect(src).toContain(`'${key}': {`);
  });
});
