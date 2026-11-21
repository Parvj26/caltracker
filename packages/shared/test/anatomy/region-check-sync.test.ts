import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BODY_AREA_IDS, MUSCLE_IDS } from '../../src/index';

// client_flags.region is checked against a fixed list in the database (20261121000500_client_flags.sql). It must name
// exactly the catalogue's ids: a new muscle or body area needs a migration widening the check, and this test says so.
const MIGRATION = fileURLToPath(new URL('../../../../supabase/migrations/20261121000500_client_flags.sql', import.meta.url));

/** The ids in the migration's region check (a later migration that widens it must update MIGRATION above). */
function regionCheckIds(sql: string): string[] {
  const m = /region text check \(region in \(([^)]*)\)\)/.exec(sql);
  if (!m) throw new Error('client_flags.region check not found in the migration');
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe('client_flags.region check', () => {
  it('lists exactly the muscle and body-area ids of the catalogue', () => {
    const ids = regionCheckIds(readFileSync(MIGRATION, 'utf8'));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...MUSCLE_IDS, ...BODY_AREA_IDS].sort());
  });
});
