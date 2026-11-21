import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TESTS } from '../../src/assessment/library';
import { checkpointsOf } from '../../src/assessment/score';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

/** Every built-in definition seeded by the migrations: the JSON between $def$ … $def$. */
function seeded(): unknown[] {
  const out: unknown[] = [];
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(/\$def\$([\s\S]*?)\$def\$/g)) out.push(JSON.parse(m[1] ?? ''));
  }
  return out;
}

describe('built-in test library', () => {
  it('has the nine phase-1 tests, each with a unique key', () => {
    expect(BUILTIN_TESTS.map((t) => t.key)).toEqual([
      'overhead_squat',
      'single_leg_squat',
      'push_up',
      'shoulder_mobility',
      'active_straight_leg_raise',
      'static_posture',
      'side_lying_hip_hold',
      'wall_shoulder_flexion',
      'seated_hip_internal_rotation',
    ]);
  });

  it('uses ids that are unique across the whole library and start with a test prefix', () => {
    const ids = BUILTIN_TESTS.flatMap((t) => [...checkpointsOf(t).map((c) => c.id), ...t.measures.map((m) => m.id), ...t.followUps.map((f) => f.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
  });

  it('gives every follow-up a checkpoint of its own test', () => {
    for (const t of BUILTIN_TESTS) {
      for (const f of t.followUps) expect(checkpointsOf(t).some((c) => c.id === f.after)).toBe(true);
    }
  });

  it('marks the three new tests as needing Luis’s review, and only those', () => {
    expect(BUILTIN_TESTS.filter((t) => t.needsReview).map((t) => t.key)).toEqual(['side_lying_hip_hold', 'wall_shoulder_flexion', 'seated_hip_internal_rotation']);
  });

  it('matches what the migrations seed into assessment_test_definitions', () => {
    expect(seeded()).toEqual(JSON.parse(JSON.stringify(BUILTIN_TESTS)));
  });
});
