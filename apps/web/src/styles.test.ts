import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every colour must come from @caltracker/design-tokens via var(--ct-*), so a dark theme can be added later.
// Files still waiting for their phase 2 restyle. This list may only shrink (Tasks 3-5 empty it).
const PENDING_RESTYLE = [
  'app/(coach)/clients/clients.module.css',
  'app/(coach)/exercises/exercises.module.css',
];

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
