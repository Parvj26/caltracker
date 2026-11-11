import { describe, expect, it } from 'vitest';
import { REPLAY_FILTERS, upsertReplayFilters } from './posthog-replay-filters';

const eventsOf = (name: string): string[] => {
  const f = REPLAY_FILTERS.find((x) => x.name === name);
  if (!f) throw new Error(`missing ${name}`);
  return f.filters.filter_group.values.flatMap((g) => g.values.map((v) => v.id));
};

describe('saved replay filters', () => {
  it('has the three the PO uses, by name', () => {
    expect(REPLAY_FILTERS.map((f) => f.name)).toEqual(['Coach friction', 'Coach errors', 'Gave up']);
  });

  it('matches the right events (any of them)', () => {
    expect(eventsOf('Coach friction')).toEqual(['$rageclick', '$dead_click']);
    expect(eventsOf('Coach errors')).toEqual(['error_shown', '$exception']);
    expect(eventsOf('Gave up')).toEqual(['task_abandoned']);
    for (const f of REPLAY_FILTERS) {
      expect(f.type).toBe('filters');
      expect(f.filters.filter_group.type).toBe('OR');
    }
  });

  it('excludes internal and test accounts', () => {
    for (const f of REPLAY_FILTERS) expect(f.filters.filter_test_accounts).toBe(true);
  });

  it('creates missing filters and updates existing ones by name (safe to re-run)', async () => {
    const calls: [string, string, unknown?][] = [];
    const api = <T>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push([method, path, body]);
      if (method === 'GET') return Promise.resolve({ results: [{ short_id: 'abc', name: 'Coach errors' }], next: null } as T);
      return Promise.resolve({ short_id: 'new' } as T);
    };
    await upsertReplayFilters(api);
    expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual([
      'GET /session_recording_playlists/?limit=200',
      'POST /session_recording_playlists/',
      'PATCH /session_recording_playlists/abc/',
      'POST /session_recording_playlists/',
    ]);
    expect((calls[2]?.[2] as { name: string }).name).toBe('Coach errors');
  });
});
