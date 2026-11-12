import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { loadHomeData, readAll } from './coach-home';

/** A fake paged query over `total` rows whose server caps each page at `cap` rows. */
function pager(total: number, cap: number) {
  const calls: Array<[number, number]> = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(total, to + 1, from + cap);
    return Promise.resolve({ data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null });
  };
  return { page, calls };
}

describe('readAll', () => {
  it('keeps reading past a short page when the server cap is below the page size', async () => {
    const { page } = pager(2500, 300);
    const rows = await readAll(page, 'rows');
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toBe(2499);
    expect(new Set(rows).size).toBe(2500);
  });

  it('reads full pages and stops at the first empty page', async () => {
    const { page, calls } = pager(2000, 1000);
    expect(await readAll(page, 'rows')).toHaveLength(2000);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('returns nothing for an empty table, and null data counts as empty', async () => {
    expect(await readAll(pager(0, 1000).page, 'rows')).toEqual([]);
    expect(await readAll(() => Promise.resolve({ data: null, error: null }), 'rows')).toEqual([]);
  });

  it('throws with what it was loading', async () => {
    await expect(readAll(() => Promise.resolve({ data: null, error: { message: 'boom' } }), 'workouts')).rejects.toThrow('Could not load workouts: boom');
  });
});

/**
 * A fake Supabase where every query answers one round after it is sent (a round = one trip to the database), and
 * which records the round each table was first asked for. Paged tables have one row on their first page.
 */
function roundsDb() {
  let round = 0;
  const sentIn: Record<string, number> = {};
  const rows: Record<string, unknown[]> = {
    workspace_members: [{ user_id: 'c1', created_at: '2026-11-01T00:00:00Z' }],
    workouts: [{ id: 'w1', client_id: 'c1', name: 'Legs', scheduled_on: '2026-11-11', assignment_id: null, workout_logs: [] }],
    workout_logs: [{ client_id: 'c1', finished_at: '2026-11-10T10:00:00Z', name: 'Legs' }],
    program_assignments: [],
    awards: [],
    profiles: [{ id: 'c1', first_name: 'Cleo', last_name: 'C' }],
  };
  const answer = (table: string, data: unknown[]) => {
    const sent = round;
    sentIn[table] ??= sent;
    return new Promise((resolve) =>
      setTimeout(() => {
        round = Math.max(round, sent + 1);
        resolve({ data, error: null });
      }, 0),
    );
  };
  const from = (table: string) => {
    let range: [number, number] | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) q[m] = () => q;
    q.range = (a: number, b: number) => ((range = [a, b]), q);
    q.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
      answer(table, range && range[0] > 0 ? [] : (rows[table] ?? [])).then(ok, fail);
    return q;
  };
  const rpc = () => answer('rpc', []);
  return { db: { from, rpc } as unknown as SupabaseClient<Database>, sentIn };
}

describe('loadHomeData', () => {
  it('asks for client names as soon as the client list is back, not after every paged read', async () => {
    const { db, sentIn } = roundsDb();
    const data = await loadHomeData(db, 'ws', '2026-11-11');
    expect(data.clients[0]).toMatchObject({ id: 'c1', firstName: 'Cleo', lastWorkoutName: 'Legs' });
    // Round 0: the first queries. Round 1: names, alongside the paged reads' check for a second page.
    expect(sentIn.profiles).toBe(1);
  });
});
