import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Supabase client that records each query's table, operation and eq() filters.
type Call = { table: string; op: string; filters: Record<string, unknown> };
const calls: Call[] = [];

function query(table: string): unknown {
  const call: Call = { table, op: 'select', filters: {} };
  const builder = {
    upsert: () => ((call.op = 'upsert'), builder),
    delete: () => ((call.op = 'delete'), builder),
    eq: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: null, error: null }).then(ok, fail);
    },
  };
  return builder;
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ userId: COACH, workspaceId: WS }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ from: query }) }));

import { setFavourite } from './actions';

const COACH = '00000000-0000-4000-8000-0000000000c1';
const WS = '00000000-0000-4000-8000-000000000001';
const EXERCISE = '00000000-0000-4000-8000-0000000000e1';

beforeEach(() => {
  calls.length = 0;
});

describe('setFavourite', () => {
  it('removes only the signed-in coach’s own star', async () => {
    expect(await setFavourite(EXERCISE, false)).toEqual({ ok: true });
    expect(calls).toEqual([
      { table: 'exercise_favorites', op: 'delete', filters: { exercise_id: EXERCISE, coach_id: COACH } },
    ]);
  });

  it('refuses an id that is not a uuid', async () => {
    expect(await setFavourite('nope', false)).toEqual({ ok: false });
    expect(calls).toEqual([]);
  });
});
