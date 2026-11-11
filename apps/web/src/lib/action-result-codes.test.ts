import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Stream C reports every fail() whose code is server_error or ends in _failed as a server error. A refusal of bad
// input (a malformed id, a wrong type) is not a server failure, so it must use another code (request_invalid).
const SRC = join(__dirname, '..');
const INPUT_CHECK = /if \(.*(UUID\.test|isUuid|typeof |instanceof |Array\.isArray|isReactionKey|resolution !==)/;
const SERVER_CODE = /fail\('(server_error|[a-z_]+_failed)'/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /actions\.ts$|^assign\.ts$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

it('never answers bad input with a server-failure code', () => {
  const hits = files(SRC).flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, at: `${f.slice(SRC.length + 1)}:${i + 1}` }))
      .filter(({ line }) => INPUT_CHECK.test(line) && SERVER_CODE.test(line))
      .map(({ at, line }) => `${at}: ${line.trim()}`),
  );
  expect(hits).toEqual([]);
});
