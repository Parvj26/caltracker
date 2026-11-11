import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Recordings show the text, aria-label, title and alt of anything marked data-ph-safe. A safe element must never
// build those attributes from data (a program, client or exercise name), so no data-ph-safe element may carry a
// computed aria-label, title or alt. This reads each opening tag (up to the next `<`).
const SRC = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return e.name.endsWith('.tsx') ? [p] : [];
  });
}

it('no data-ph-safe element has a computed aria-label, title or alt', () => {
  const hits: string[] = [];
  for (const f of files(SRC)) {
    const source = readFileSync(f, 'utf8');
    for (const tag of source.match(/<[A-Za-z][^<]*?data-ph-safe[^<]*/gs) ?? []) {
      if (/\b(aria-label|title|alt)=\{/.test(tag)) hits.push(`${f.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  expect(hits).toEqual([]);
});
