import { beforeEach, describe, expect, it, vi } from 'vitest';

// "+ Create '<query>'" in the exercise search: a custom exercise with a name and tracking type, refused when a
// built-in or the workspace's own exercise already has that name (case and spacing ignored).

let existing: { id: string; name: string }[] = [];
const inserts: unknown[] = [];
const filters: string[] = [];

function query() {
  const builder = {
    select: () => builder,
    or: (f: string) => (filters.push(f), builder),
    ilike: (_c: string, p: string) => (filters.push(p), builder),
    limit: () => Promise.resolve({ data: existing, error: null }),
    insert: (row: unknown) => (inserts.push(row), builder),
    single: () => Promise.resolve({ data: { id: 'new-id' }, error: null }),
  };
  return builder;
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: '00000000-0000-4000-8000-000000000001' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ from: query }) }));

import { quickCreateExercise } from './actions';

beforeEach(() => {
  existing = [];
  inserts.length = 0;
  filters.length = 0;
});

describe('quickCreateExercise', () => {
  it('creates a workspace custom exercise with the name and tracking type', async () => {
    expect(await quickCreateExercise({ name: '  Sandbag   carry ', trackingType: 'reps' })).toEqual({
      ok: true,
      id: 'new-id',
      name: 'Sandbag carry',
      trackingType: 'reps',
    });
    expect(inserts[0]).toMatchObject({ workspace_id: '00000000-0000-4000-8000-000000000001', source: 'custom', name: 'Sandbag carry', tracking_type: 'reps' });
    // Only built-ins and this workspace's own exercises are checked.
    expect(filters[0]).toBe('workspace_id.is.null,workspace_id.eq.00000000-0000-4000-8000-000000000001');
  });

  it('refuses a name already used (case and spacing ignored) and names the one that has it', async () => {
    existing = [{ id: 'b1', name: 'Sandbag Carry' }];
    expect(await quickCreateExercise({ name: 'sandbag  CARRY', trackingType: 'reps' })).toMatchObject({
      ok: false,
      code: 'exercise_name_taken',
      existing: { id: 'b1', name: 'Sandbag Carry' },
    });
    expect(inserts).toHaveLength(0);
  });

  it('treats LIKE wildcards in the name as plain text', async () => {
    existing = [{ id: 'x', name: 'Push up 100' }];
    expect(await quickCreateExercise({ name: '100%_push', trackingType: 'reps' })).toMatchObject({ ok: true });
    expect(filters[1]).toBe('100\\%\\_push');
  });

  it('refuses a blank name or an unknown tracking type', async () => {
    expect(await quickCreateExercise({ name: '  ', trackingType: 'reps' })).toMatchObject({ ok: false });
    expect(await quickCreateExercise({ name: 'Burpee', trackingType: 'calories' })).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });
});
