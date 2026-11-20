import { describe, expect, it } from 'vitest';
import { readAllPages } from '../../src/metrics/pages';

const server = (total: number, cap: number) => {
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + cap, total);
    return Promise.resolve(Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i));
  };
  return { page, calls };
};

describe('readAllPages', () => {
  it('reads every row past the 1000-row cap', async () => {
    const s = server(2500, 1000);
    const rows = await readAllPages(s.page);
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toBe(2499);
    expect(s.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
  });

  it('loses nothing when the server cap is smaller than the page size', async () => {
    const rows = await readAllPages(server(450, 100).page, 1000);
    expect(rows).toEqual(Array.from({ length: 450 }, (_, i) => i));
  });

  it('handles an empty list', async () => {
    expect(await readAllPages(server(0, 1000).page)).toEqual([]);
  });

  it('stops with an error instead of loading without end', async () => {
    await expect(readAllPages(server(5000, 1000).page, 1000, 3000)).rejects.toThrow('More than 3000 rows.');
  });

  it('passes on a failing page', async () => {
    await expect(readAllPages(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  });
});
