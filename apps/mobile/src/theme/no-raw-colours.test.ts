import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, it } from 'vitest';

// Colours come from @caltracker/design-tokens via src/theme. Anything else is a raw colour that drifts.
const SRC = join(__dirname, '..');
const THEME = join(SRC, 'theme') + sep;
const RAW = /['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

it('has no raw colours outside src/theme', () => {
  const hits = files(SRC)
    .filter((f) => !f.startsWith(THEME))
    .flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => RAW.test(line))
        .map(({ line, i }) => `${relative(SRC, f)}:${i + 1}: ${line.trim()}`),
    );
  expect(hits).toEqual([]);
});
