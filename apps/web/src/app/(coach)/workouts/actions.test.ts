import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Supabase client that records each query's table, operation and eq() filters.
type Call = { table: string; op: string; filters: Record<string, unknown>; rpc?: string; payload?: unknown };
type Result = { data?: unknown; error?: { code?: string; message: string } | null };
const calls: Call[] = [];
let respond: (call: Call) => Result = () => ({ data: null, error: null });

function query(table: string): unknown {
  const call: Call = { table, op: 'select', filters: {} };
  const builder = {
    select: () => builder,
    upsert: () => ((call.op = 'upsert'), builder),
    delete: () => ((call.op = 'delete'), builder),
    eq: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    is: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    maybeSingle: () => builder,
    then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: null, error: null, ...respond(call) }).then(ok, fail);
    },
  };
  return builder;
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ userId: COACH, workspaceId: WS }) }));
const rpc = (name: string, args: unknown) => {
  const call: Call = { table: '', op: 'rpc', rpc: name, payload: args, filters: {} };
  calls.push(call);
  return Promise.resolve({ data: null, error: null, ...respond(call) });
};
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ from: query, rpc }) }));
const loadWorkoutDoc = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/workouts', () => ({ loadWorkoutDoc: (...args: unknown[]) => loadWorkoutDoc(...args) }));

import { duplicateWorkout, setFavourite } from './actions';

const COACH = '00000000-0000-4000-8000-0000000000c1';
const WS = '00000000-0000-4000-8000-000000000001';
const EXERCISE = '00000000-0000-4000-8000-0000000000e1';

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: null, error: null });
  loadWorkoutDoc.mockReset();
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

describe('duplicateWorkout', () => {
  const WORKOUT = '00000000-0000-4000-8000-0000000000a1';
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const doc = {
    id: WORKOUT,
    name: 'Upper A',
    notes: null,
    sections: [],
    blocks: [
      {
        id: id(2),
        sectionId: null,
        kind: 'straight',
        exercises: [
          {
            id: id(3),
            exerciseId: EXERCISE,
            exerciseName: 'Squat',
            trackingType: 'weight_reps',
            note: null,
            sets: [
              { id: id(4), setType: 'normal', targetRepsMin: 5, targetRepsMax: 5, targetWeightKg: 100, targetDurationS: null, targetDistanceM: null, toFailure: false, restSeconds: 120, note: null },
            ],
          },
        ],
      },
    ],
  };

  it('copies a library workout of this workspace through save_workout, as a new "<name> (copy)"', async () => {
    respond = (call) => (call.op === 'rpc' ? { data: 'new-id' } : { data: { id: WORKOUT } });
    loadWorkoutDoc.mockResolvedValue({ doc, clientId: null, scheduledOn: null });
    expect(await duplicateWorkout(WORKOUT)).toEqual({ ok: true, id: 'new-id' });
    expect(calls[0]).toMatchObject({ table: 'workouts', filters: { id: WORKOUT, workspace_id: WS, client_id: null } });
    const save = calls.find((c) => c.op === 'rpc');
    expect(save?.rpc).toBe('save_workout');
    const args = save?.payload as { p_workspace_id: string; p_doc: { id: string; name: string; blocks: Array<{ id: string }> } };
    expect(args.p_workspace_id).toBe(WS);
    expect(args.p_doc.name).toBe('Upper A (copy)');
    expect(args.p_doc.id).not.toBe(WORKOUT);
    expect(args.p_doc.blocks[0]!.id).not.toBe(id(2));
  });

  it('refuses a workout that is not in this workspace\'s library, without saving anything', async () => {
    respond = () => ({ data: null });
    expect((await duplicateWorkout(WORKOUT)).ok).toBe(false);
    expect(loadWorkoutDoc).not.toHaveBeenCalled();
    expect(calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await duplicateWorkout('nope')).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
