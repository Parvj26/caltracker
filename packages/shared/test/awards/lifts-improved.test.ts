import { describe, expect, it } from 'vitest';
import { liftsImprovedBetween } from '../../src/awards/week-prs';

const ev = (logId: string, exerciseId: string, achievedAt: string) => ({ clientId: 'c1', logId, exerciseId, achievedAt });

describe('liftsImprovedBetween', () => {
  it('counts PRs whose local day is inside the range, inclusive', () => {
    const events = [
      ev('l1', 'sq', '2026-11-01T00:00:00Z'),
      ev('l2', 'bp', '2026-11-30T23:59:00Z'),
      ev('l3', 'sq', '2026-10-31T23:59:00Z'),
      ev('l4', 'sq', '2026-12-01T00:00:00Z'),
    ];
    expect(liftsImprovedBetween(events, '2026-11-01', '2026-11-30', 'UTC')).toBe(2);
  });

  it('counts a lift that broke several records in one workout once', () => {
    const events = [ev('l1', 'sq', '2026-11-03T10:00:00Z'), ev('l1', 'sq', '2026-11-03T10:00:00Z'), ev('l2', 'sq', '2026-11-05T10:00:00Z')];
    expect(liftsImprovedBetween(events, '2026-11-01', '2026-11-30', 'UTC')).toBe(2);
  });

  it('reads the day in the given time zone', () => {
    // 03:00 UTC on Dec 1 is still Nov 30 in New York.
    expect(liftsImprovedBetween([ev('l1', 'sq', '2026-12-01T03:00:00Z')], '2026-11-01', '2026-11-30', 'America/New_York')).toBe(1);
  });
});
