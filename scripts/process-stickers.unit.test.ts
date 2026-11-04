import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANVAS, LOCKED_SIZE, processSticker, SIZES } from './process-stickers';

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

describe('processSticker', () => {
  it('writes every size and the locked silhouette as square images', async () => {
    const written = await processSticker(await fixture('red-panda'), dir);
    expect(written.sort()).toEqual(
      [
        `red-panda@${CANVAS}.png`,
        ...SIZES.flatMap((s) => [`red-panda@${s}.png`, `red-panda@${s}.webp`]),
        `red-panda-locked@${LOCKED_SIZE}.png`,
        `red-panda-locked@${LOCKED_SIZE}.webp`,
      ].sort(),
    );
    for (const s of SIZES) {
      const m = await sharp(path.join(dir, `red-panda@${s}.webp`)).metadata();
      expect([m.width, m.height, m.hasAlpha]).toEqual([s, s, true]);
    }
  });

  it('trims and centres the artwork, keeping its corners transparent', async () => {
    await processSticker(await fixture('cat'), dir);
    const { data, info } = await sharp(path.join(dir, `cat@${CANVAS}.png`)).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => data.slice((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
    expect(px(CANVAS / 2, CANVAS / 2 - 6)).toEqual(Buffer.from([255, 0, 0, 255])); // art centred (lifted 6px)
    expect(px(0, 0)[3]).toBe(0);
    expect(px(CANVAS - 1, CANVAS - 1)[3]).toBe(0);
  });

  it('makes the locked silhouette one flat grey colour', async () => {
    await processSticker(await fixture('okapi'), dir);
    const { data } = await sharp(path.join(dir, `okapi-locked@${LOCKED_SIZE}.png`)).raw().toBuffer({ resolveWithObject: true });
    const centre = ((LOCKED_SIZE / 2) * LOCKED_SIZE + LOCKED_SIZE / 2) * 4;
    expect([...data.slice(centre, centre + 4)]).toEqual([0xda, 0xda, 0xda, 255]);
  });

  it('rejects an image without a transparent background', async () => {
    const file = path.join(dir, 'flat.png');
    await writeFile(file, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer());
    await expect(processSticker(file, dir)).rejects.toThrow('needs a transparent background');
  });
});
