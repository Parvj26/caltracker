import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALSO_CHECK_IDS, MUSCLE_IDS } from '../../src/index';

// The step 2 tables check muscle ids and "Also check" ids against fixed lists (20261121002000_assessment_findings.sql).
// They must match the shared catalogues: a new muscle group or check needs a migration widening them.
const MIGRATION = fileURLToPath(new URL('../../../../supabase/migrations/20261121002000_assessment_findings.sql', import.meta.url));
const sql = readFileSync(MIGRATION, 'utf8');
const idsIn = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);

describe('step 2 check lists', () => {
  it('every muscle_id check lists exactly the catalogue muscles', () => {
    const lists = [...sql.matchAll(/muscle_id text not null check \(muscle_id in \(([^)]*)\)\)/g)].map((m) => idsIn(m[1]!));
    expect(lists).toHaveLength(3);
    for (const ids of lists) expect([...ids].sort()).toEqual([...MUSCLE_IDS].sort());
  });

  it('the check_id check lists exactly ALSO_CHECK_IDS', () => {
    const m = /check_id text not null check \(check_id in \(([^)]*)\)\)/.exec(sql);
    expect([...idsIn(m![1]!)].sort()).toEqual([...ALSO_CHECK_IDS].sort());
  });
});
