import { describe, expect, it } from 'vitest';
import { historyRow, monthSummary, parseHistoryCache, type HistoryLog } from './workout-history';

const log = (over: Partial<HistoryLog> = {}): HistoryLog => ({
  id: 'l1',
  name: 'Upper B',
  finishedAt: '2026-11-06T18:00:00Z',
  durationS: 52 * 60,
  volumeKg: 4463.4,
  loggedByCoach: false,
  pr: true,
  ...over,
});

describe('historyRow', () => {
  it('shows the day, duration and weight lifted in the client’s units', () => {
    expect(historyRow(log(), 'lb', null, 'UTC')).toMatchObject({
      id: 'l1',
      dow: 'Fri',
      num: 6,
      name: 'Upper B',
      meta: '52 min · 9,840 lb lifted',
      pr: true,
    });
  });

  it('says who logged it when the coach did, and leaves out zero weight', () => {
    expect(historyRow(log({ loggedByCoach: true, volumeKg: 0 }), 'kg', 'Luis', 'UTC').meta).toBe('Logged by Luis · 52 min');
    expect(historyRow(log({ loggedByCoach: true, volumeKg: 0 }), 'kg', null, 'UTC').meta).toBe('Logged by your coach · 52 min');
  });

  it('reads the day in the phone’s time zone', () => {
    expect(historyRow(log({ finishedAt: '2026-11-07T03:00:00Z' }), 'kg', null, 'America/New_York').num).toBe(6);
  });

  it('has a spoken label', () => {
    expect(historyRow(log(), 'lb', null, 'UTC').label).toBe('Upper B, Fri 6 Nov, 52 min · 9,840 lb lifted, personal record');
  });
});

describe('monthSummary', () => {
  const prs = [
    { clientId: 'c', logId: 'l1', exerciseId: 'sq', achievedAt: '2026-11-06T18:00:00Z' },
    { clientId: 'c', logId: 'l1', exerciseId: 'sq', achievedAt: '2026-11-06T18:00:00Z' },
    { clientId: 'c', logId: 'l0', exerciseId: 'bp', achievedAt: '2026-10-30T18:00:00Z' },
  ];
  it('counts this month’s workouts, time and lifts improved', () => {
    const logs = [log(), log({ id: 'l2', finishedAt: '2026-11-02T10:00:00Z', durationS: 3600 }), log({ id: 'l0', finishedAt: '2026-10-30T18:00:00Z' })];
    expect(monthSummary(logs, prs, '2026-11-09', 'UTC')).toEqual({ title: 'November so far', workouts: 2, time: '1 h 52 min', prs: 1 });
  });

  it('says 0 min of training with no workouts', () => {
    expect(monthSummary([], [], '2026-11-09', 'UTC')).toEqual({ title: 'November so far', workouts: 0, time: '0 min', prs: 0 });
  });
});

describe('parseHistoryCache', () => {
  it('reads back a saved copy and rejects anything else', () => {
    const saved = { logs: [log()], prs: [], streak: 2 };
    expect(parseHistoryCache(JSON.stringify(saved))).toEqual(saved);
    expect(parseHistoryCache('{"logs":[{"id":1}]}')).toBeNull();
    expect(parseHistoryCache('nope')).toBeNull();
    expect(parseHistoryCache(null)).toBeNull();
  });
});
