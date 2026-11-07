import { describe, expect, it } from 'vitest';
import type { PersonalRecord } from '../../src/awards/prs';
import { awardRecords, recentPrAmount, recentPrs } from '../../src/awards/recent-prs';

const NOW = new Date('2026-11-07T12:00:00Z');
const pr = (exerciseId: string, achievedAt: string, over: Partial<PersonalRecord> = {}): PersonalRecord => ({
  exerciseId,
  kind: 'heaviest',
  valueKg: 60,
  reps: 8,
  logId: `log-${achievedAt}`,
  achievedAt,
  ...over,
});

describe('awardRecords', () => {
  it('reads the PRs from stored award results and skips anything malformed', () => {
    const good = pr('bench', '2026-11-06T10:00:00Z');
    const results = [
      { prs: [good, { ...good, kind: 'nope' }, { ...good, valueKg: -1 }, { ...good, achievedAt: 'later' }, null] },
      { prs: 'none' },
      null,
      'text',
      { prs: [{ ...good, exerciseId: 'curl', reps: undefined }] },
    ];
    expect(awardRecords(results)).toEqual([good, { ...good, exerciseId: 'curl', reps: null }]);
  });
});

describe('recentPrs', () => {
  it('keeps the last 7 days, newest first, at most 3', () => {
    const list = [
      pr('a', '2026-11-01T11:00:00Z'), // 6 days 1 hour ago
      pr('b', '2026-10-31T11:00:00Z'), // more than 7 days ago
      pr('c', '2026-11-06T09:00:00Z'),
      pr('d', '2026-11-05T09:00:00Z'),
      pr('e', '2026-11-04T09:00:00Z'),
    ];
    expect(recentPrs(list, NOW).map((p) => p.exerciseId)).toEqual(['c', 'd', 'e']);
    expect(recentPrs(list, NOW, 7, 10).map((p) => p.exerciseId)).toEqual(['c', 'd', 'e', 'a']);
  });

  it('shows each exercise once: its newest workout, and a real set before an estimated max', () => {
    const same = 'log-1';
    const list = [
      pr('bench', '2026-11-06T10:00:00Z', { logId: same, kind: 'e1rm', valueKg: 80 }),
      pr('bench', '2026-11-06T10:00:00Z', { logId: same, kind: 'reps_at_weight', valueKg: 60, reps: 10 }),
      pr('bench', '2026-11-06T10:00:00Z', { logId: same, kind: 'heaviest', valueKg: 70, reps: 3 }),
      pr('squat', '2026-11-03T10:00:00Z', { logId: 'old', valueKg: 100 }),
      pr('squat', '2026-11-05T10:00:00Z', { logId: 'new', valueKg: 105 }),
    ];
    const out = recentPrs(list, NOW);
    expect(out.map((p) => [p.exerciseId, p.kind, p.valueKg])).toEqual([
      ['bench', 'heaviest', 70],
      ['squat', 'heaviest', 105],
    ]);
  });

  it('is empty with nothing recent', () => {
    expect(recentPrs([], NOW)).toEqual([]);
    expect(recentPrs([pr('a', '2026-10-01T00:00:00Z')], NOW)).toEqual([]);
  });
});

describe('recentPrAmount', () => {
  it('reads weight × reps in the reader’s units, and an estimated max without reps', () => {
    expect(recentPrAmount({ kind: 'heaviest', valueKg: 100, reps: 5 }, 'kg')).toBe('100 kg × 5');
    expect(recentPrAmount({ kind: 'reps_at_weight', valueKg: 27.2155, reps: 8 }, 'lb')).toBe('60 lb × 8');
    expect(recentPrAmount({ kind: 'e1rm', valueKg: 80, reps: 3 }, 'kg')).toBe('80 kg est. max');
    expect(recentPrAmount({ kind: 'heaviest', valueKg: 80, reps: null }, 'kg')).toBe('80 kg');
  });
});
