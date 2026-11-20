import { beforeEach, describe, expect, it, vi } from 'vitest';

// The coach's Metrics actions: checked input, the workspace from the session, and database refusals as codes.
type Call = { op: string; payload?: unknown; filters: Record<string, unknown> };
const calls: Call[] = [];
let updateRows: unknown[] = [];
let insertError: { code: string; message: string } | null = null;
let existing: unknown = { id: 'x' };
let deleteRows: unknown[] = [{ id: 'x' }];

function query() {
  const call: Call = { op: 'select', filters: {} };
  const result = () => {
    calls.push(call);
    if (call.op === 'update') return { data: updateRows, error: null };
    if (call.op === 'insert') return { data: null, error: insertError };
    if (call.op === 'delete') return { data: deleteRows, error: null };
    return { data: existing, error: null };
  };
  const builder = {
    select: () => builder,
    update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), builder),
    insert: (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), builder),
    delete: () => ((call.op = 'delete'), builder),
    eq: (col: string, v: unknown) => ((call.filters[col] = v), builder),
    maybeSingle: () => Promise.resolve(result()),
    then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
  };
  return builder;
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: 'ws' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ from: query }) }));
vi.mock('@/lib/analytics/server', () => ({ reportServerError: () => {} }));

import { deleteMetricEntry, saveMetricEntry } from './actions';

const ID = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-8000-000000000002';
const input = { id: ID, clientId: CLIENT, metricKey: 'vo2_max' as const, measuredOn: '2026-11-10', value: 42.5 };

beforeEach(() => {
  calls.length = 0;
  updateRows = [];
  insertError = null;
  existing = { id: 'x' };
  deleteRows = [{ id: 'x' }];
});

describe('saveMetricEntry', () => {
  it('adds a new manual entry as the coach, in the session workspace', async () => {
    expect(await saveMetricEntry(input)).toEqual({ ok: true });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.payload).toEqual({
      id: ID, workspace_id: 'ws', client_id: CLIENT, metric_key: 'vo2_max', value: 42.5, measured_on: '2026-11-10',
      source: 'manual', entered_by_role: 'coach',
    });
  });

  it('edits the entry when it already exists (a retry adds nothing)', async () => {
    updateRows = [{ id: ID }];
    expect(await saveMetricEntry(input)).toEqual({ ok: true });
    expect(calls.map((c) => c.op)).toEqual(['update']);
    expect(calls[0]!.filters).toMatchObject({ id: ID, workspace_id: 'ws', client_id: CLIENT });
  });

  it('refuses bad input before touching the database', async () => {
    expect(await saveMetricEntry({ ...input, value: 101 })).toEqual({ ok: false, code: 'metric_invalid' });
    expect(await saveMetricEntry({ ...input, metricKey: 'steps' as never })).toEqual({ ok: false, code: 'metric_invalid' });
    expect(await saveMetricEntry({ ...input, measuredOn: 'today' })).toEqual({ ok: false, code: 'metric_invalid' });
    expect(await saveMetricEntry({ ...input, clientId: 'nope' })).toEqual({ ok: false, code: 'metric_invalid' });
    expect(calls).toHaveLength(0);
  });

  it('turns database refusals into codes', async () => {
    insertError = { code: '23505', message: 'duplicate key' };
    expect(await saveMetricEntry(input)).toEqual({ ok: false, code: 'metric_edit_denied' });
    insertError = { code: '42501', message: 'row-level security' };
    expect(await saveMetricEntry(input)).toEqual({ ok: false, code: 'metric_save_denied' });
    insertError = { code: '23514', message: 'The date is not valid.' };
    expect(await saveMetricEntry(input)).toEqual({ ok: false, code: 'metric_invalid' });
    insertError = { code: '08006', message: 'gone' };
    expect(await saveMetricEntry(input)).toEqual({ ok: false, code: 'metric_save_failed' });
  });
});

describe('deleteMetricEntry', () => {
  it('deletes an entry the coach may delete', async () => {
    expect(await deleteMetricEntry(ID)).toEqual({ ok: true });
    expect(calls.find((c) => c.op === 'delete')?.filters).toEqual({ id: ID, workspace_id: 'ws' });
  });

  it('says when it is gone or not the coach to delete', async () => {
    existing = null;
    expect(await deleteMetricEntry(ID)).toEqual({ ok: false, code: 'metric_already_gone' });
    existing = { id: ID };
    deleteRows = [];
    expect(await deleteMetricEntry(ID)).toEqual({ ok: false, code: 'metric_edit_denied' });
    expect(await deleteMetricEntry('x')).toEqual({ ok: false, code: 'metric_invalid' });
  });
});
