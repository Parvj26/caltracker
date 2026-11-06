import { describe, expect, it } from 'vitest';
import { readAll } from './coach-home';

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
