import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Supabase client: every query is recorded, and `respond` decides what it returns.
type Call = { table: string; op: string; payload?: unknown; filters: Record<string, unknown> };
type Result = { data?: unknown; error?: { code?: string; message: string } | null };
const calls: Call[] = [];
const removed: string[][] = [];
let respond: (call: Call) => Result = () => ({ data: null, error: null });

function query(table: string): unknown {
  const call: Call = { table, op: 'select', filters: {} };
  const builder = {
    select: () => builder,
    insert: (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), builder),
    update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), builder),
    eq: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    is: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    then: (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: null, error: null, ...respond(call) }).then(ok, fail);
    },
  };
  return builder;
}
const supabase = {
  from: query,
  storage: { from: () => ({ remove: (paths: string[]) => (removed.push(paths), Promise.resolve({ data: [], error: null })) }) },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: WS }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(supabase) }));

import { removeCoachMeal, saveCoachMeal } from './actions';

const WS = '00000000-0000-4000-8000-000000000001';
const MEAL = '00000000-0000-4000-8000-000000000002';
const PHOTO = '00000000-0000-4000-8000-000000000003';
const OLD = '00000000-0000-4000-8000-000000000004';
const base = { id: MEAL, name: 'Turkey chili', calories: '490', protein: '45', carbs: '38', fat: '14', ingredients: '', howTo: '', photo: null, dropPaths: [] };

beforeEach(() => {
  calls.length = 0;
  removed.length = 0;
  respond = () => ({ data: null, error: null });
});

describe('saveCoachMeal', () => {
  it('saves a new meal in the coach\'s workspace', async () => {
    await expect(saveCoachMeal(base)).resolves.toEqual({ ok: true });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.table).toBe('coach_meals');
    expect(insert?.payload).toMatchObject({ id: MEAL, workspace_id: WS, name: 'Turkey chili', calories: 490, protein_g: 45, carbs_g: 38, fat_g: 14 });
  });

  it('updates when the meal is already there, and says so when it is gone', async () => {
    respond = (c) => (c.op === 'insert' ? { error: { code: '23505', message: 'duplicate' } } : { data: [{ id: MEAL }] });
    await expect(saveCoachMeal({ ...base, calories: '500' })).resolves.toEqual({ ok: true });
    const update = calls.find((c) => c.op === 'update');
    expect(update?.payload).toMatchObject({ calories: 500 });
    expect(update?.payload).not.toHaveProperty('workspace_id');
    // A removed meal is never edited back to life.
    expect(update?.filters).toMatchObject({ id: MEAL, workspace_id: WS, deleted_at: null });

    respond = (c) => (c.op === 'insert' ? { error: { code: '23505', message: 'duplicate' } } : { data: [] });
    await expect(saveCoachMeal(base)).resolves.toEqual({ ok: false, code: 'meal_locked' });
  });

  it('rejects a long name and a bad number before saving', async () => {
    await expect(saveCoachMeal({ ...base, name: 'x'.repeat(41) })).resolves.toEqual({ ok: false, code: 'meal_details_invalid' });
    await expect(saveCoachMeal({ ...base, calories: 'abc' })).resolves.toEqual({ ok: false, code: 'meal_details_invalid' });
    expect(calls).toEqual([]);
  });

  it('rejects a photo outside this meal\'s files', async () => {
    const photo = { path: `${WS}/${OLD}-${PHOTO}.webp`, thumbPath: `${WS}/${OLD}-${PHOTO}-thumb.webp`, width: 100, height: 100 };
    await expect(saveCoachMeal({ ...base, photo })).resolves.toEqual({ ok: false, code: 'meal_photo_invalid' });
    expect(calls).toEqual([]);
  });

  it('saves a photo and deletes the files it replaced (only this meal\'s)', async () => {
    const photo = { path: `${WS}/${MEAL}-${PHOTO}.webp`, thumbPath: `${WS}/${MEAL}-${PHOTO}-thumb.webp`, width: 1600, height: 1200 };
    const old = [`${WS}/${MEAL}-${OLD}.jpg`, `${WS}/${MEAL}-${OLD}-thumb.jpg`, `${WS}/other-file.jpg`];
    await expect(saveCoachMeal({ ...base, photo, dropPaths: old })).resolves.toEqual({ ok: true });
    expect(calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ photo_path: photo.path, photo_thumb_path: photo.thumbPath, photo_width: 1600 });
    expect(removed).toEqual([old.slice(0, 2)]);
  });
});

describe('removeCoachMeal', () => {
  it('marks the meal removed (clients stop seeing it, logged meals stay)', async () => {
    respond = () => ({ data: [{ id: MEAL }] });
    await expect(removeCoachMeal(MEAL)).resolves.toEqual({ ok: true });
    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('coach_meals');
    expect(update?.payload).toHaveProperty('deleted_at');
    expect(update?.filters).toMatchObject({ id: MEAL, workspace_id: WS });
  });
  it('says when there was nothing to remove', async () => {
    respond = () => ({ data: [] });
    await expect(removeCoachMeal(MEAL)).resolves.toEqual({ ok: false, code: 'meal_not_found' });
  });
});
