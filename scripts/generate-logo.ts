// Generates every app icon, favicon and in-app logo image from the one mark design.
//   pnpm --filter @caltracker/scripts exec tsx generate-logo.ts
// Re-run after changing the mark; commit the outputs. The master drawing is
// packages/design-tokens/assets/logo-mark.svg (kept in sync by markSvg below and its test).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const LIME = '#C8F169';
const INK = '#121212';
const PINK = '#B9E3FF'; // the dot: blue since 2026-11-09 (name kept)

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type MarkOptions = {
  /** Tile fill; null for a transparent background. */
  background: string | null;
  /** Corner radius of the tile in the 120-unit design (0 = square, for icons the OS masks itself). */
  radius: number;
  /** Shrinks the C and dot towards the centre (1 = as designed); Android needs a safe zone. */
  scale: number;
  /** Colour of the C; the dot is dropped when `dot` is false (one-colour icons). */
  ring: string;
  dot: boolean;
};

/** The mark as an SVG string in a 120 × 120 box. */
export function markSvg({ background, radius, scale, ring, dot }: MarkOptions): string {
  const tile = background ? `<rect width="120" height="120" rx="${radius}" fill="${background}"/>` : '';
  const art =
    `<path d="M84 36 A34 34 0 1 0 84 84" fill="none" stroke="${ring}" stroke-width="16" stroke-linecap="round"/>` +
    (dot ? `<circle cx="90" cy="60" r="9" fill="${PINK}"/>` : '');
  const t = (1 - scale) * 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${tile}<g transform="translate(${t} ${t}) scale(${scale})">${art}</g></svg>`;
}

export const OUTPUTS: { path: string; size: number; options: MarkOptions }[] = [
  // iOS masks the corners itself, so the icon is a full square with no transparency.
  { path: 'apps/mobile/assets/images/icon.png', size: 1024, options: { background: LIME, radius: 0, scale: 1, ring: INK, dot: true } },
  // Android adaptive icon: background layer + foreground inside the 66% safe zone + one-colour version.
  { path: 'apps/mobile/assets/images/android-icon-background.png', size: 512, options: { background: LIME, radius: 0, scale: 0, ring: INK, dot: false } },
  { path: 'apps/mobile/assets/images/android-icon-foreground.png', size: 512, options: { background: null, radius: 0, scale: 0.62, ring: INK, dot: true } },
  { path: 'apps/mobile/assets/images/android-icon-monochrome.png', size: 432, options: { background: null, radius: 0, scale: 0.62, ring: INK, dot: false } },
  // Launch screen: the rounded tile on white.
  { path: 'apps/mobile/assets/images/splash-icon.png', size: 512, options: { background: LIME, radius: 27, scale: 1, ring: INK, dot: true } },
  // In-app logo next to the wordmark (React Native picks @2x/@3x by screen density).
  { path: 'apps/mobile/assets/images/logo-mark.png', size: 40, options: { background: LIME, radius: 27, scale: 1, ring: INK, dot: true } },
  { path: 'apps/mobile/assets/images/logo-mark@2x.png', size: 80, options: { background: LIME, radius: 27, scale: 1, ring: INK, dot: true } },
  { path: 'apps/mobile/assets/images/logo-mark@3x.png', size: 120, options: { background: LIME, radius: 27, scale: 1, ring: INK, dot: true } },
  // Website: icon when saved to an iPhone home screen (iOS rounds it).
  { path: 'apps/web/src/app/apple-icon.png', size: 180, options: { background: LIME, radius: 0, scale: 1, ring: INK, dot: true } },
];

async function main() {
  for (const { path, size, options } of OUTPUTS) {
    const out = join(root, path);
    mkdirSync(dirname(out), { recursive: true });
    await sharp(Buffer.from(markSvg(options)), { density: 72 * (size / 120) * 2 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`wrote ${path} (${size}px)`);
  }
  // Browser tab icon: the vector itself (Next serves app/icon.svg as the favicon).
  const favicon = join(root, 'apps/web/src/app/icon.svg');
  writeFileSync(favicon, markSvg({ background: LIME, radius: 27, scale: 1, ring: INK, dot: true }) + '\n');
  console.log('wrote apps/web/src/app/icon.svg');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
