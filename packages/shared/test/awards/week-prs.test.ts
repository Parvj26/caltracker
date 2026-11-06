import { describe, expect, it } from 'vitest';
import { awardPrEvents, prsThisWeek } from '../../src/awards/week-prs';

const ev = (clientId: string, logId: string, exerciseId: string, achievedAt: string) => ({ clientId, logId, exerciseId, achievedAt });
// 2026-11-05 is a Thursday: the week is Mon 2026-11-02 to Sun 2026-11-08.
const TODAY = '2026-11-05';
const mine = new Set(['c1', 'c2']);

describe('prsThisWeek', () => {
  it('counts PRs achieved Monday to Sunday of the current week', () => {
    const events = [
      ev('c1', 'l1', 'sq', '2026-11-02T00:00:00Z'),
      ev('c1', 'l2', 'sq', '2026-11-08T23:59:00Z'),
      ev('c2', 'l3', 'bp', '2026-11-04T12:00:00Z'),
      ev('c1', 'l4', 'sq', '2026-11-01T23:59:00Z'), // Sunday before
      ev('c1', 'l5', 'sq', '2026-11-09T00:00:00Z'), // Monday after
    ];
    expect(prsThisWeek(events, mine, TODAY, 'UTC')).toBe(3);
  });

  it('counts one PR per exercise per workout, however many records it broke', () => {
    const events = [
      ev('c1', 'l1', 'sq', '2026-11-03T10:00:00Z'),
      ev('c1', 'l1', 'sq', '2026-11-03T10:00:00Z'),
      ev('c1', 'l1', 'sq', '2026-11-03T10:05:00Z'),
      ev('c1', 'l1', 'bp', '2026-11-03T10:30:00Z'),
    ];
    expect(prsThisWeek(events, mine, TODAY, 'UTC')).toBe(2);
  });

  it('counts current clients only', () => {
    expect(prsThisWeek([ev('gone', 'l1', 'sq', '2026-11-03T10:00:00Z')], mine, TODAY, 'UTC')).toBe(0);
  });

  it('reads the day in the coach time zone', () => {
    const e = [ev('c1', 'l1', 'sq', '2026-11-01T20:00:00Z')]; // Sunday evening UTC, Monday morning in Auckland
    expect(prsThisWeek(e, mine, TODAY, 'UTC')).toBe(0);
    expect(prsThisWeek(e, mine, TODAY, 'Pacific/Auckland')).toBe(1);
  });

  it('is zero with no records', () => {
    expect(prsThisWeek([], mine, TODAY, 'UTC')).toBe(0);
  });
});

describe('awardPrEvents', () => {
  it('reads the PRs out of a stored award result', () => {
    const result = { prs: [{ exerciseId: 'sq', kind: 'heaviest', valueKg: 100, reps: 5, logId: 'l1', achievedAt: '2026-11-03T10:00:00Z' }] };
    expect(awardPrEvents('c1', result)).toEqual([ev('c1', 'l1', 'sq', '2026-11-03T10:00:00Z')]);
  });

  it('copes with a missing, empty or malformed result', () => {
    expect(awardPrEvents('c1', null)).toEqual([]);
    expect(awardPrEvents('c1', {})).toEqual([]);
    expect(awardPrEvents('c1', { prs: 'x' })).toEqual([]);
    expect(awardPrEvents('c1', { prs: [{ exerciseId: 'sq' }, null, 3] })).toEqual([]);
  });
});
