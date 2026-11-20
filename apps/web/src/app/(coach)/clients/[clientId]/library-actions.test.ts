import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addStraightBlock, emptyWorkout, type WorkoutDoc } from '@caltracker/shared';

// "+ New workout" on a client's calendar (createClientWorkout) and "Save to Library" in a calendar workout's ⋯ menu
// (saveToLibrary). The database does the real checks (create_client_workout, save_workout, schedule_workout); these
// tests pin what the actions send and how they answer.

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const CLIENT = '00000000-0000-4000-8000-0000000000c2';
const NEW_ID = '00000000-0000-4000-8000-0000000000aa';
const CAL = '00000000-0000-4000-8000-0000000000bb';

type Rpc = { name: string; payload: Record<string, unknown> };
const rpcs: Rpc[] = [];
let rpcErrors: Record<string, { code: string; message: string } | undefined> = {};
let libraryNames: string[] = [];
let loaded: { doc: WorkoutDoc; clientId: string | null; scheduledOn: string | null } | null = null;

function query(table: string): unknown {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    not: () => builder,
    maybeSingle: () =>
      Promise.resolve(
        table === 'profiles'
          ? { data: { first_name: 'Vaishali' }, error: null }
          : { data: loaded ? { id: CAL, scheduled_on: loaded.scheduledOn, client_id: loaded.clientId } : null, error: null },
      ),
    then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve({ data: libraryNames.map((name) => ({ name })), error: null }).then(ok, fail),
  };
  return builder;
}
const supabase = {
  from: query,
  rpc: (name: string, payload: Record<string, unknown>) => {
    rpcs.push({ name, payload });
    const error = rpcErrors[name] ?? null;
    const data = name === 'save_workout' ? (payload.p_doc as { id: string }).id : null;
    return Promise.resolve({ data: error ? null : data, error });
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: 'ws' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(supabase) }));
vi.mock('@/lib/workouts', () => ({ loadWorkoutDoc: () => Promise.resolve(loaded) }));

import { createClientWorkout, saveToLibrary } from './actions';

const doc = (name = 'Vaishali - Upper') =>
  addStraightBlock(emptyWorkout(id, name), { id: id(), name: 'Barbell Squat', trackingType: 'weight_reps' }, id);

beforeEach(() => {
  rpcs.length = 0;
  rpcErrors = {};
  libraryNames = [];
  loaded = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('createClientWorkout', () => {
  const input = (alsoLibrary: boolean, d = doc()) => ({ doc: d, clientId: CLIENT, date: '2026-11-20', today: '2026-11-20', alsoLibrary, newId: NEW_ID });

  it('puts the workout on the client’s day only, never in the Library', async () => {
    const d = doc();
    expect(await createClientWorkout(input(false, d))).toEqual({ ok: true, id: d.id });
    expect(rpcs.map((r) => r.name)).toEqual(['create_client_workout']);
    expect(rpcs[0]!.payload).toMatchObject({ p_workspace_id: 'ws', p_client_id: CLIENT, p_date: '2026-11-20' });
  });

  it('with "Also save to Library" saves it to the Library, then puts that on the day the usual way', async () => {
    const d = doc();
    expect(await createClientWorkout(input(true, d))).toEqual({ ok: true, id: NEW_ID });
    expect(rpcs.map((r) => r.name)).toEqual(['save_workout', 'schedule_workout']);
    expect(rpcs[1]!.payload).toMatchObject({ p_new_id: NEW_ID, p_workout_id: d.id, p_client_id: CLIENT, p_date: '2026-11-20' });
  });

  it('refuses a past day and an empty workout before writing anything', async () => {
    expect(await createClientWorkout({ ...input(false), date: '2026-11-19' })).toMatchObject({ ok: false, code: 'date_in_past' });
    expect(await createClientWorkout(input(false, emptyWorkout(id, 'Empty')))).toMatchObject({ ok: false, code: 'workout_fields_invalid' });
    expect(rpcs).toHaveLength(0);
  });

  it('says so when the client is no longer theirs', async () => {
    rpcErrors.create_client_workout = { code: '42501', message: 'no' };
    expect(await createClientWorkout(input(false))).toMatchObject({ ok: false, code: 'client_not_current' });
  });
});

describe('saveToLibrary', () => {
  beforeEach(() => {
    loaded = { doc: doc('Monday Upper'), clientId: CLIENT, scheduledOn: '2026-11-20' };
  });

  it('saves the plan as a new library workout with fresh ids', async () => {
    const outcome = await saveToLibrary({ workoutId: CAL });
    expect(outcome).toMatchObject({ ok: true, name: 'Monday Upper' });
    const saved = rpcs[0]!.payload.p_doc as WorkoutDoc & { rememberChoices: boolean };
    expect(rpcs[0]!.name).toBe('save_workout');
    expect(saved.id).not.toBe(loaded!.doc.id);
    expect(saved.blocks[0]!.id).not.toBe(loaded!.doc.blocks[0]!.id);
    expect(saved.blocks[0]!.exercises[0]!.sets).toHaveLength(loaded!.doc.blocks[0]!.exercises[0]!.sets.length);
    expect(saved.rememberChoices).toBe(false);
  });

  it('on a name clash saves nothing and suggests "<name> (<first name>, <day>)"', async () => {
    libraryNames = ['monday upper'];
    expect(await saveToLibrary({ workoutId: CAL })).toMatchObject({
      ok: false,
      code: 'library_name_taken',
      suggestion: 'Monday Upper (Vaishali, Fri 20 Nov)',
    });
    expect(rpcs).toHaveLength(0);
    expect(await saveToLibrary({ workoutId: CAL, name: 'Monday Upper (Vaishali, Fri 20 Nov)' })).toMatchObject({ ok: true });
  });

  it('refuses a workout that is not on a client calendar', async () => {
    loaded = null;
    expect(await saveToLibrary({ workoutId: CAL })).toMatchObject({ ok: false, code: 'workout_not_found' });
    expect(await saveToLibrary({ workoutId: 'nope' })).toMatchObject({ ok: false, code: 'request_invalid' });
  });
});
