import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@caltracker/shared';
import { CACHE_MS, invalidateExerciseIndex, loadExerciseIndex } from './exercise-index';

/** A stand-in client: counts how often the exercises table is read. */
function fakeClient(userId: string | null) {
  const state = { loads: 0 };
  const exercises = {
    select: () => exercises,
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

describe('loadExerciseIndex cache', () => {
  beforeEach(() => {
    invalidateExerciseIndex();
    vi.useRealTimers();
  });

  it('reuses a fresh result for the same user', async () => {
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client);
    await loadExerciseIndex(client);
    expect(state.loads).toBe(1);
  });

  it('loads afresh for a different user', async () => {
    const a = fakeClient('coach-a');
    const b = fakeClient('coach-b');
    await loadExerciseIndex(a.client);
    await loadExerciseIndex(b.client);
    expect(b.state.loads).toBe(1);
  });

  it('reloads after invalidateExerciseIndex()', async () => {
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client);
    invalidateExerciseIndex();
    await loadExerciseIndex(client);
    expect(state.loads).toBe(2);
  });

  it('reloads once the result is older than the backstop', async () => {
    vi.useFakeTimers();
    const { client, state } = fakeClient('coach-a');
    await loadExerciseIndex(client);
    vi.advanceTimersByTime(CACHE_MS + 1);
    await loadExerciseIndex(client);
    expect(state.loads).toBe(2);
  });
});
