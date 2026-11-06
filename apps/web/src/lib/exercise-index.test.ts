import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@caltracker/shared';
import { CACHE_MS, invalidateExerciseIndex, loadExerciseIndex } from './exercise-index';

/** A stand-in client: counts how often the exercises table is read. */
function fakeClient(userId: string | null) {
  const state = { loads: 0, filters: [] as string[] };
  const exercises = {
    select: () => exercises,
    or: (f: string) => {
      state.filters.push(f);
      return exercises;
    },
    order: () => exercises,
    range: () => {
      state.loads++;
      return Promise.resolve({ data: [], error: null });
    },
  };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: userId ? { user: { id: userId } } : null } }) },
    from: (table: string) => (table === 'exercises' ? exercises : { select: () => Promise.resolve({ data: [], error: null }) }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as SupabaseClient<Database>;
  return { client, state };
}

const WS_A = '00000000-0000-4000-8000-00000000000a';
const WS_B = '00000000-0000-4000-8000-00000000000b';

describe('loadExerciseIndex workspace scope', () => {
  beforeEach(() => invalidateExerciseIndex());

  it('asks only for built-ins and this workspace’s own exercises (RLS alone would also return a client membership’s)', async () => {
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client, WS_A);
    expect(state.filters).toEqual([`workspace_id.is.null,workspace_id.eq.${WS_A}`]);
  });

  it('loads afresh for another workspace of the same user', async () => {
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client, WS_A);
    await loadExerciseIndex(client, WS_B);
    expect(state.loads).toBe(2);
    expect(state.filters[1]).toBe(`workspace_id.is.null,workspace_id.eq.${WS_B}`);
  });

  it('refuses a workspace id that is not a uuid', async () => {
    const { client, state } = fakeClient('coach-a');
    await expect(loadExerciseIndex(client, 'x,workspace_id.neq.null')).rejects.toThrow();
    expect(state.loads).toBe(0);
  });
});

describe('loadExerciseIndex cache', () => {
  beforeEach(() => {
    invalidateExerciseIndex();
    vi.useRealTimers();
  });

  it('reuses a fresh result for the same user', async () => {
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client, WS_A);
    await loadExerciseIndex(client, WS_A);
    expect(state.loads).toBe(1);
  });

  it('loads afresh for a different user', async () => {
    const a = fakeClient('coach-a');
    const b = fakeClient('coach-b');
    await loadExerciseIndex(a.client, WS_A);
    await loadExerciseIndex(b.client, WS_A);
    expect(b.state.loads).toBe(1);
  });

  it('reloads after invalidateExerciseIndex()', async () => {
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client, WS_A);
    invalidateExerciseIndex();
    await loadExerciseIndex(client, WS_A);
    expect(state.loads).toBe(2);
  });

  it('reloads once the result is older than the backstop', async () => {
    vi.useFakeTimers();
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client, WS_A);
    vi.advanceTimersByTime(CACHE_MS + 1);
    await loadExerciseIndex(client, WS_A);
    expect(state.loads).toBe(2);
  });
});
