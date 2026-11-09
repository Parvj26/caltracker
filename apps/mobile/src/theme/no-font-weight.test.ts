import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, it } from 'vitest';

// Bricolage Grotesque is bundled as one file per weight, and iOS ignores `fontWeight` on such a family: bold text
// must pick the weight's font file (fontFamilyFor / textStyle), or it silently renders at the base weight.
const SRC = join(__dirname, '..');
const THEME = join(SRC, 'theme') + sep;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

it('never sets fontWeight outside src/theme', () => {
  const hits = files(SRC)
    .filter((f) => !f.startsWith(THEME))
    .flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /\bfontWeight\s*:/.test(line))
        .map(({ line, i }) => `${relative(SRC, f)}:${i + 1}: ${line.trim()}`),
    );
  expect(hits).toEqual([]);
});
