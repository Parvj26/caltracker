import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Supabase client: every query is recorded, and `respond` decides what it returns.
type Call = { table: string; op: string; payload?: unknown; filters: Record<string, unknown>; rpc?: string };
type Result = { data?: unknown; error?: { code?: string; message: string } | null };
const calls: Call[] = [];
let respond: (call: Call) => Result = () => ({ data: null, error: null });

function query(table: string): unknown {
  const call: Call = { table, op: 'select', filters: {} };
  const builder = {
    select: () => builder,
    insert: (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), builder),
    update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), builder),
    delete: () => ((call.op = 'delete'), builder),
    eq: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    gt: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
    single: () => builder,
    then: (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: null, error: null, ...respond(call) }).then(ok, fail);
    },
  };
  return builder;
}
const supabase = {
  from: query,
  rpc: (name: string, args: unknown) => {
    const call: Call = { table: '', op: 'rpc', rpc: name, payload: args, filters: {} };
    calls.push(call);
    return Promise.resolve({ data: null, error: null, ...respond(call) });
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: WS }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(supabase) }));

import { addProgramWorkout, updateProgram } from './actions';

const WS = '00000000-0000-4000-8000-000000000001';
const PROGRAM = '00000000-0000-4000-8000-000000000002';
const SLOT = '00000000-0000-4000-8000-000000000003';
const WORKOUT = '00000000-0000-4000-8000-000000000004';
const DUPLICATE = { code: '23505', message: 'duplicate key value violates unique constraint "program_workouts_pkey"' };

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: null, error: null });
});

describe('addProgramWorkout retried with the same id', () => {
  const input = { id: SLOT, programId: PROGRAM, week: 2, day: 3, workoutId: WORKOUT };
  const answer = (existing: unknown) => (call: Call): Result => {
    if (call.table === 'programs') return { data: { weeks: 4 } };
    if (call.op === 'insert') return { error: DUPLICATE };
    if (call.filters.id === SLOT) return { data: existing };
    return { data: [] };
  };

  it('succeeds when the first try already saved that slot', async () => {
    respond = answer({ program_id: PROGRAM, week: 2, day: 3, workout_id: WORKOUT });
    await expect(addProgramWorkout(input)).resolves.toBeUndefined();
    const check = calls.find((c) => c.op === 'select' && c.filters.id === SLOT);
    expect(check?.filters.workspace_id).toBe(WS);
  });

  it('still fails when that id belongs to a different slot', async () => {
    respond = answer({ program_id: PROGRAM, week: 1, day: 3, workout_id: WORKOUT });
    await expect(addProgramWorkout(input)).rejects.toThrow('Could not add the workout');
  });

  it('still fails when no slot with that id can be seen', async () => {
    respond = answer(null);
    await expect(addProgramWorkout(input)).rejects.toThrow('Could not add the workout');
  });
});

describe('updateProgram', () => {
  const input = { name: 'Strength', description: null, weeks: 4 };

  it('saves the name and description before changing the number of weeks', async () => {
    respond = (call) => (call.op === 'select' ? { data: { weeks: 6 } } : call.op === 'rpc' ? { data: 2 } : {});
    await expect(updateProgram(PROGRAM, input)).resolves.toEqual({ ok: true, removedSlots: 2 });
    const order = calls.filter((c) => c.op !== 'select').map((c) => c.rpc ?? c.op);
    expect(order).toEqual(['update', 'set_program_weeks']);
  });

  it('does not change the weeks when saving the name fails', async () => {
    respond = (call) => (call.op === 'select' ? { data: { weeks: 6 } } : call.op === 'update' ? { error: { message: 'boom' } } : {});
    const result = await updateProgram(PROGRAM, input);
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});
