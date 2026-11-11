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
    is: (col: string, v: unknown) => ((call.filters[col] = v), builder),
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

import { addStraightBlock, emptyWorkout } from '@caltracker/shared';
import { addProgramWorkout, copyProgramWeek, duplicateProgram, saveSlotCopy, updateProgram } from './actions';

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

describe('duplicateProgram', () => {
  it('copies only a program of the coach\'s workspace, as "<name> (copy)"', async () => {
    respond = (call) => (call.table === 'programs' ? { data: { name: 'Strength' } } : {});
    const result = await duplicateProgram(PROGRAM);
    expect(result.ok).toBe(true);
    const read = calls.find((c) => c.table === 'programs');
    expect(read?.filters).toEqual({ id: PROGRAM, workspace_id: WS });
    const rpc = calls.find((c) => c.op === 'rpc');
    expect(rpc?.rpc).toBe('duplicate_program');
    expect(rpc?.payload).toMatchObject({ p_program_id: PROGRAM, p_name: 'Strength (copy)' });
    expect(result.ok && (rpc?.payload as { p_new_id: string }).p_new_id).toBe(result.ok && result.id);
  });

  it('refuses a program it cannot find in this workspace, without calling the database function', async () => {
    respond = () => ({ data: null });
    expect(await duplicateProgram(PROGRAM)).toEqual({ ok: false, error: "Couldn't find that program. It may have been deleted." });
    expect(calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await duplicateProgram('nope')).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('copyProgramWeek', () => {
  const ids = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012'];

  it('sends the browser\'s ids to copy_program_week in one call and returns the saved slots', async () => {
    respond = (call) =>
      call.op === 'rpc'
        ? {
            data: [
              { id: ids[0], week: 2, day: 1, position: 0, workout_id: WORKOUT },
              { id: ids[1], week: 3, day: 1, position: 0, workout_id: WORKOUT },
            ],
          }
        : {};
    const result = await copyProgramWeek({ programId: PROGRAM, fromWeek: 1, toWeeks: [2, 3], ids });
    expect(calls).toEqual([
      { table: '', op: 'rpc', rpc: 'copy_program_week', payload: { p_program_id: PROGRAM, p_from: 1, p_to: [2, 3], p_ids: ids }, filters: {} },
    ]);
    expect(result).toEqual({
      ok: true,
      slots: [
        { id: ids[0], week: 2, day: 1, position: 0, workoutId: WORKOUT },
        { id: ids[1], week: 3, day: 1, position: 0, workoutId: WORKOUT },
      ],
    });
  });

  it('passes on the database\'s coach-worded refusal (a week changed since the page loaded)', async () => {
    respond = () => ({ error: { code: '23514', message: 'That week changed since the page loaded. Reload the page and try again.' } });
    expect(await copyProgramWeek({ programId: PROGRAM, fromWeek: 1, toWeeks: [2], ids })).toEqual({
      ok: false,
      error: 'That week changed since the page loaded. Reload the page and try again.',
    });
  });

  it('says the program is gone when the database refuses it (another workspace\'s program)', async () => {
    respond = () => ({ error: { code: '42501', message: 'Program not found.' } });
    const result = await copyProgramWeek({ programId: PROGRAM, fromWeek: 1, toWeeks: [2], ids });
    expect(result).toEqual({ ok: false, error: "Couldn't find that program. It may have been deleted." });
  });

  it('refuses bad input before touching the database', async () => {
    for (const input of [
      { programId: 'nope', fromWeek: 1, toWeeks: [2], ids },
      { programId: PROGRAM, fromWeek: 0, toWeeks: [2], ids },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [], ids },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [2.5], ids },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [3, 2], ids },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [2, 2], ids },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [1], ids },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [2], ids: [] },
      { programId: PROGRAM, fromWeek: 1, toWeeks: [2], ids: ['nope'] },
    ]) {
      expect((await copyProgramWeek(input)).ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });
});

describe('saveSlotCopy ("Just Week N, Day M")', () => {
  const COPY = '00000000-0000-4000-8000-000000000009';
  let n = 100;
  const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const doc = () =>
    addStraightBlock(emptyWorkout(makeId, 'Upper'), { id: makeId(), name: 'Bench', trackingType: 'weight_reps' }, makeId);

  it('saves the edits as "<name> (Week N, Ddd)" with new ids and points only this day at it', async () => {
    const edited = doc();
    respond = (call) => {
      if (call.table === 'program_workouts' && call.op === 'select') return { data: { program_id: PROGRAM, week: 3, day: 2 } };
      if (call.rpc === 'save_workout') return { data: COPY };
      if (call.rpc === 'set_program_slot_workout') return { data: true };
      return {};
    };
    expect(await saveSlotCopy({ slotId: SLOT, doc: edited })).toEqual({ ok: true, id: COPY, name: 'Upper (Week 3, Tue)' });
    const saved = calls.find((c) => c.rpc === 'save_workout')!.payload as { p_doc: { id: string; name: string } };
    expect(saved.p_doc.name).toBe('Upper (Week 3, Tue)');
    expect(saved.p_doc.id).not.toBe(edited.id);
    expect(calls.find((c) => c.rpc === 'set_program_slot_workout')).toMatchObject({
      payload: { p_slot_id: SLOT, p_workout_id: COPY },
    });
  });

  it('deletes the copy again when the day could not be pointed at it', async () => {
    respond = (call) => {
      if (call.table === 'program_workouts' && call.op === 'select') return { data: { program_id: PROGRAM, week: 1 } };
      if (call.rpc === 'save_workout') return { data: COPY };
      if (call.rpc === 'set_program_slot_workout') return { data: false };
      return {};
    };
    expect((await saveSlotCopy({ slotId: SLOT, doc: doc() })).ok).toBe(false);
    expect(calls.find((c) => c.op === 'delete')).toMatchObject({ table: 'workouts', filters: { id: COPY, workspace_id: WS, client_id: null } });
  });

  it('refuses a day outside the workspace without saving anything', async () => {
    respond = () => ({ data: null });
    expect(await saveSlotCopy({ slotId: SLOT, doc: doc() })).toEqual({ ok: false, error: "Couldn't find that day. It may have been removed." });
    expect(calls.some((c) => c.rpc === 'save_workout')).toBe(false);
  });
});
