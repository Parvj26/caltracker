import { describe, expect, it } from 'vitest';
import { historyLogFromRow, historyRow, monthSummary, parseHistoryCache, type HistoryLog, type HistoryLogRow } from './workout-history';

const log = (over: Partial<HistoryLog> = {}): HistoryLog => ({
  id: 'l1',
  name: 'Upper B',
  finishedAt: '2026-11-06T18:00:00Z',
  durationS: 52 * 60,
  volumeKg: 4463.4,
  loggedByCoach: false,
  loggedBy: null,
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
    expect(historyRow(log({ loggedByCoach: true, loggedBy: 'k', volumeKg: 0 }), 'kg', { id: 'k', firstName: 'Luis' }, 'UTC').meta).toBe(
      'Logged by Luis · 52 min',
    );
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
    expect(monthSummary(logs, prs, '2026-11-09', 'UTC')).toEqual({ title: 'November so far', workouts: 2, time: '1h 52m', prs: 1 });
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

describe('historyLogFromRow', () => {
  const row = (over: Partial<HistoryLogRow> = {}): HistoryLogRow => ({
    id: 'l1',
    name: 'Upper B',
    started_at: '2026-11-06T17:00:00Z',
    finished_at: '2026-11-06T17:52:00Z',
    last_activity_at: '2026-11-06T17:52:00Z',
    logged_by: 'c1',
    log_blocks: [
      {
        id: 'b1',
        kind: 'straight',
        picked_exercise_id: null,
        log_exercises: [
          {
            id: 'e1',
            exercises: { tracking_type: 'weight_reps' },
            log_sets: [
              { set_type: 'warmup', actual_reps: 10, actual_weight_kg: 20, completed_at: '2026-11-06T17:05:00Z' },
              { set_type: 'normal', actual_reps: 8, actual_weight_kg: '60.5', completed_at: '2026-11-06T17:10:00Z' },
              { set_type: 'normal', actual_reps: 8, actual_weight_kg: 60, completed_at: null },
            ],
          },
        ],
      },
      {
        id: 'b2',
        kind: 'choice',
        picked_exercise_id: 'e3',
        log_exercises: [
          { id: 'e2', exercises: { tracking_type: 'weight_reps' }, log_sets: [{ set_type: 'normal', actual_reps: 10, actual_weight_kg: 100, completed_at: '2026-11-06T17:20:00Z' }] },
          { id: 'e3', exercises: { tracking_type: 'weight_reps' }, log_sets: [{ set_type: 'normal', actual_reps: 5, actual_weight_kg: 10, completed_at: '2026-11-06T17:20:00Z' }] },
        ],
      },
    ],
    ...over,
  });

  it('sums duration and volume with the shared rules (done non-warm-up sets of the picked option)', () => {
    expect(historyLogFromRow(row(), 'c1', new Set(['l1']))).toEqual({
      id: 'l1',
      name: 'Upper B',
      finishedAt: '2026-11-06T17:52:00Z',
      durationS: 52 * 60,
      volumeKg: 534,
      loggedByCoach: false,
      loggedBy: 'c1',
      pr: true,
    });
  });

  it('marks a coach-logged workout and skips an unfinished one', () => {
    expect(historyLogFromRow(row({ logged_by: 'coach' }), 'c1', new Set())).toMatchObject({ loggedByCoach: true, loggedBy: 'coach', pr: false });
    expect(historyLogFromRow(row({ finished_at: null }), 'c1', new Set())).toBeNull();
  });
});

describe('who logged it', () => {
  it('names the coach only when they are the client’s current coach', () => {
    const coached = log({ loggedByCoach: true, loggedBy: 'coach-1', volumeKg: 0 });
    expect(historyRow(coached, 'kg', { id: 'coach-1', firstName: 'Luis' }, 'UTC').meta).toBe('Logged by Luis · 52 min');
    expect(historyRow(coached, 'kg', { id: 'coach-2', firstName: 'Ana' }, 'UTC').meta).toBe('Logged by your coach · 52 min');
  });
});
