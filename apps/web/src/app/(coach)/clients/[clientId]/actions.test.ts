import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The server refuses dates the dashboard already blocks, so a stale or hand-made request can't slip a single workout
// into the past or start a program more than 7 days back. "Today" comes from the browser and must be within a day
// of the server's UTC date.
type Call = { op: string; rpc?: string; payload?: unknown };
const calls: Call[] = [];
let rpcError: { code: string; message: string } | null = null;

function query(): unknown {
  const call: Call = { op: 'select' };
  const builder = {
    select: () => builder,
    update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), builder),
    eq: () => builder,
    not: () => builder,
    then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: [{ id: 'x' }], error: null, count: 1 }).then(ok, fail);
    },
  };
  return builder;
}
const supabase = {
  from: query,
  rpc: (name: string, payload: unknown) => {
    calls.push({ op: 'rpc', rpc: name, payload });
    return Promise.resolve({ data: rpcError ? null : ASSIGNMENT, error: rpcError });
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: 'ws' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(supabase) }));

import { assignProgram, moveClientWorkout, scheduleWorkout } from './actions';

const ASSIGNMENT = '00000000-0000-4000-8000-000000000001';
const PROGRAM = '00000000-0000-4000-8000-000000000002';
const CLIENT = '00000000-0000-4000-8000-000000000003';
const WORKOUT = '00000000-0000-4000-8000-000000000004';
const NEW_ID = '00000000-0000-4000-8000-000000000005';

beforeEach(() => {
  calls.length = 0;
  rpcError = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const rpcs = () => calls.filter((c) => c.op === 'rpc' || c.op === 'update');

describe('scheduleWorkout', () => {
  const input = { newId: NEW_ID, workoutId: WORKOUT, clientId: CLIENT, date: '2026-11-05', today: '2026-11-05' };

  it('adds a workout today or later', async () => {
    expect(await scheduleWorkout(input)).toEqual({ ok: true });
    expect(await scheduleWorkout({ ...input, date: '2026-12-01' })).toEqual({ ok: true });
    expect(rpcs()).toHaveLength(2);
  });

  it("refuses a date before the browser's today", async () => {
    expect(await scheduleWorkout({ ...input, date: '2026-11-04' })).toEqual({ ok: false, error: 'Pick today or a later date.' });
    expect(rpcs()).toHaveLength(0);
  });

  it("uses the browser's today, which may be a day either side of UTC", async () => {
    // Auckland is already on the 6th, so the 5th is the past there.
    expect(await scheduleWorkout({ ...input, today: '2026-11-06' })).toMatchObject({ ok: false });
    // Los Angeles is still on the 4th, so the 4th is fine there.
    expect(await scheduleWorkout({ ...input, date: '2026-11-04', today: '2026-11-04' })).toEqual({ ok: true });
  });

  it('says clearly when the same id was already used for a different workout or day', async () => {
    rpcError = { code: '23505', message: 'duplicate key value violates unique constraint "workouts_pkey"' };
    expect(await scheduleWorkout(input)).toEqual({
      ok: false,
      error: 'This add was already sent with a different workout or day. Close this, check the calendar, then add again if needed.',
    });
  });

  it('refuses a "today" more than a day from UTC', async () => {
    const out = await scheduleWorkout({ ...input, date: '2026-11-01', today: '2026-11-01' });
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.error).toMatch(/date looks wrong/);
    expect(rpcs()).toHaveLength(0);
  });
});

describe('moveClientWorkout', () => {
  it('moves to today or later', async () => {
    expect(await moveClientWorkout({ workoutId: WORKOUT, date: '2026-11-09', today: '2026-11-05' })).toEqual({ ok: true });
    expect(rpcs()).toHaveLength(1);
  });

  it('refuses a past date and a far-off today', async () => {
    expect(await moveClientWorkout({ workoutId: WORKOUT, date: '2026-11-04', today: '2026-11-05' })).toEqual({
      ok: false,
      error: 'Pick today or a later date.',
    });
    expect(await moveClientWorkout({ workoutId: WORKOUT, date: '2026-12-04', today: '2026-12-01' })).toMatchObject({ ok: false });
    expect(rpcs()).toHaveLength(0);
  });
});

describe('assignProgram', () => {
  const input = { assignmentId: ASSIGNMENT, programId: PROGRAM, clientId: CLIENT, startDate: '2026-11-09', today: '2026-11-05' };

  it('assigns from up to 7 days ago', async () => {
    expect(await assignProgram({ ...input, startDate: '2026-10-29' })).toMatchObject({ ok: true });
    expect(await assignProgram(input)).toMatchObject({ ok: true });
  });

  it('refuses a start 8 days ago and a far-off today', async () => {
    expect(await assignProgram({ ...input, startDate: '2026-10-28' })).toEqual({
      ok: false,
      error: 'Programs can start up to 7 days ago.',
    });
    expect(await assignProgram({ ...input, today: '2026-11-08' })).toMatchObject({ ok: false });
    expect(rpcs()).toHaveLength(0);
  });
});
