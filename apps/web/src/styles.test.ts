import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toCssVariables } from '@caltracker/design-tokens';

// Every colour must come from @caltracker/design-tokens via var(--ct-*), so a dark theme can be added later.
// Files still waiting for their phase 2 restyle. This list may only shrink (now empty: every web CSS file is restyled).
const PENDING_RESTYLE: string[] = [];

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
const srcDir = fileURLToPath(new URL('.', import.meta.url));
const cssFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.css'))
  .map((f) => relative(srcDir, join(srcDir, f)).split('\\').join('/'))
  .sort();
const hasRawColour = (file: string) => RAW_COLOUR.test(readFileSync(join(srcDir, file), 'utf8'));

describe('web CSS uses design tokens only', () => {
  it('finds the CSS files', () => {
    expect(cssFiles).toContain('app/globals.css');
  });

  it.each(cssFiles.filter((f) => !PENDING_RESTYLE.includes(f)))('%s has no raw colours', (file) => {
    expect(hasRawColour(file), `${file} has a raw colour; use var(--ct-*)`).toBe(false);
  });

  it.each(PENDING_RESTYLE)('%s still needs its restyle (otherwise remove it from PENDING_RESTYLE)', (file) => {
    expect(cssFiles, `${file} no longer exists; remove it from PENDING_RESTYLE`).toContain(file);
    expect(hasRawColour(file), `${file} has no raw colours left; remove it from PENDING_RESTYLE`).toBe(true);
  });
});

// A var(--ct-*) that no token defines is silently ignored by the browser (e.g. a padding of --ct-space-5, which
// doesn't exist, became 0 and squashed a dialog). Every token a stylesheet uses must be defined.
describe('web CSS only uses tokens that exist', () => {
  const css = cssFiles.map((f) => [f, readFileSync(join(srcDir, f), 'utf8')] as const);
  const defined = new Set<string>([
    ...[...toCssVariables().matchAll(/(--ct-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    ...css.flatMap(([, text]) => [...text.matchAll(/(--ct-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!)),
    // Font families are defined by next/font in the root layout (variable: '--ct-font-…').
    ...[...readFileSync(join(srcDir, 'app/layout.tsx'), 'utf8').matchAll(/variable:\s*'(--ct-[a-z0-9-]+)'/g)].map((m) => m[1]!),
  ]);

  it('defines some tokens (sanity check)', () => {
    expect(defined.has('--ct-lime')).toBe(true);
  });

  it.each(css.map(([f]) => f))('%s uses only defined tokens', (file) => {
    const text = css.find(([f]) => f === file)![1];
    const used = [...text.matchAll(/var\((--ct-[a-z0-9-]+)/g)].map((m) => m[1]!);
    const missing = [...new Set(used.filter((t) => !defined.has(t)))];
    expect(missing, `${file} uses undefined tokens`).toEqual([]);
  });
});
