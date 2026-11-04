// Turns the AI-generated sticker PNGs (transparent background, white die-cut border already drawn)
// into app assets: trimmed and centred on a square canvas, soft shadow, several sizes, plus a grey
// silhouette for locked stickers. See docs/design/sticker-prompt-pack.md.
//
// Usage: pnpm --filter @caltracker/scripts exec tsx process-stickers.ts <inDir> <outDir>
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp, { type Sharp } from 'sharp';

export const CANVAS = 1024;
/** Longest side of the artwork inside the canvas; the rest is room for the shadow. */
export const ART = 900;
export const SIZES = [512, 256, 128] as const;
export const LOCKED_SIZE = 256;
const SHADOW_COLOUR = '#121212'; // ink token
const LOCKED_COLOUR = '#DADADA';

const clear = { r: 0, g: 0, b: 0, alpha: 0 };
const blank = () => sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: clear } });

async function solidFromAlpha(alphaPng: Buffer, colour: string): Promise<Buffer> {
  const rgb = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 3, background: colour } }).png().toBuffer();
  return sharp(rgb).joinChannel(alphaPng).png().toBuffer();
}

/** Writes `<name>@1024.png`, `<name>@<size>.{png,webp}` and `<name>-locked@256.{png,webp}`. Returns the file names. */
export async function processSticker(file: string, outDir: string): Promise<string[]> {
  const name = path.basename(file, '.png');
  const meta = await sharp(file).metadata();
  if (!meta.hasAlpha) throw new Error(`${name}: needs a transparent background (no alpha channel)`);

  const trimmed = await sharp(file).ensureAlpha().trim({ threshold: 10 }).png().toBuffer();
  const fitted = await sharp(trimmed).resize(ART, ART, { fit: 'inside' }).png().toBuffer();
  const { width = ART, height = ART } = await sharp(fitted).metadata();
  const placed = await blank()
    .composite([{ input: fitted, left: Math.round((CANVAS - width) / 2), top: Math.round((CANVAS - height) / 2) }])
    .png()
    .toBuffer();

  const alpha = await sharp(placed).extractChannel('alpha').png().toBuffer();
  const shadowAlpha = await sharp(alpha).linear(0.22, 0).blur(9).png().toBuffer();
  const shadow = await solidFromAlpha(shadowAlpha, SHADOW_COLOUR);
  // The sticker sits slightly above its shadow.
  const master = await blank()
    .composite([{ input: shadow, left: 0, top: 0 }, { input: placed, left: 0, top: -6 }])
    .png()
    .toBuffer();

  const written: string[] = [];
  const out = async (img: Sharp, fileName: string) => {
    await img.toFile(path.join(outDir, fileName));
    written.push(fileName);
  };
  await out(sharp(master).png({ compressionLevel: 9 }), `${name}@${CANVAS}.png`);
  for (const size of SIZES) {
    await out(sharp(master).resize(size, size).webp({ quality: 90, alphaQuality: 100 }), `${name}@${size}.webp`);
    await out(sharp(master).resize(size, size).png({ compressionLevel: 9 }), `${name}@${size}.png`);
  }
  const locked = await solidFromAlpha(alpha, LOCKED_COLOUR);
  await out(sharp(locked).resize(LOCKED_SIZE, LOCKED_SIZE).webp({ quality: 90 }), `${name}-locked@${LOCKED_SIZE}.webp`);
  await out(sharp(locked).resize(LOCKED_SIZE, LOCKED_SIZE).png(), `${name}-locked@${LOCKED_SIZE}.png`);
  return written;
}

export async function processStickers(inDir: string, outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const files = (await readdir(inDir)).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  for (const f of files) {
    await processSticker(path.join(inDir, f), outDir);
    console.log(`processed ${f}`);
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [inDir, outDir] = process.argv.slice(2);
  if (!inDir || !outDir) {
    console.error('Usage: tsx process-stickers.ts <inDir> <outDir>');
    process.exit(1);
  }
  await processStickers(inDir, outDir);
}
