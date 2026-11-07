import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRACKING_TYPES } from '@caltracker/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const overrides = JSON.parse(await readFile(path.join(here, 'exercise-tracking-overrides.json'), 'utf8')) as Record<
  string,
  string
>;
const fixMigration = await readFile(
  path.join(here, '../supabase/migrations/20261106014100_library_tracking_fixes.sql'),
  'utf8',
);

describe('exercise tracking overrides', () => {
  it('uses only known tracking types', () => {
    for (const [id, t] of Object.entries(overrides)) expect(TRACKING_TYPES, id).toContain(t);
  });

  it('tracks Arm Circles by reps and Farmer’s Walk by weight and time', () => {
    expect(overrides.Arm_Circles).toBe('reps');
    expect(overrides.Farmers_Walk).toBe('weight_time');
  });

  it('agrees with the migration that fixes existing rows', () => {
    const pairs = [...fixMigration.matchAll(/\('([^']+)', '([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [id, t] of pairs) expect(overrides[id!], id).toBe(t);
  });
});
