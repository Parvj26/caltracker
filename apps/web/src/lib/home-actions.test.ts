import { describe, expect, it } from 'vitest';
import type { TodayRow, WorkoutStatus } from '@caltracker/shared';
import { todayAction, todayMenu, todayPill } from './home-actions';
import { minutesSince, trainingNow, type LiveLog } from './home-live';

const COACH = 'coach';
const row = (status: WorkoutStatus): TodayRow => ({
  workout: { id: 'w1', clientId: 'c1', name: 'Leg day', scheduledOn: '2026-11-07', logs: [] },
  client: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', joinedOn: '2026-10-01', lastFinishedOn: null },
  status,
});

describe('todayAction', () => {
  it('offers exactly one action per state', () => {
    expect(todayAction(row({ kind: 'not_started' }), COACH)).toEqual({ label: 'Log session', href: '/clients/c1/log/w1', style: 'filled' });
    expect(todayAction(row({ kind: 'training', logId: 'l1', loggedBy: 'c1' }), COACH)).toEqual({ label: 'Watch', href: '/clients/c1/logs/l1', style: 'outlined' });
    expect(todayAction(row({ kind: 'training', logId: 'l1', loggedBy: COACH }), COACH)).toEqual({ label: 'Continue', href: '/clients/c1/log/w1', style: 'filled' });
    expect(todayAction(row({ kind: 'done', logId: 'l1', durationS: 3000 }), COACH)).toEqual({ label: 'View', href: '/clients/c1/logs/l1', style: 'light' });
  });

  it('treats a log with no logger (an old row) as the client training: Watch', () => {
    expect(todayAction(row({ kind: 'training', logId: 'l1', loggedBy: null }), COACH).label).toBe('Watch');
  });
});

describe('todayPill', () => {
  it('names the state', () => {
    expect(todayPill(row({ kind: 'not_started' }), COACH)).toEqual({ label: 'Not started', tone: 'idle' });
    expect(todayPill(row({ kind: 'training', logId: 'l1', loggedBy: 'c1' }), COACH)).toEqual({ label: '● Live', tone: 'live' });
    expect(todayPill(row({ kind: 'training', logId: 'l1', loggedBy: COACH }), COACH).label).toBe('● You’re logging');
    expect(todayPill(row({ kind: 'done', logId: 'l1', durationS: 60 }), COACH)).toEqual({ label: '✓ Done', tone: 'done' });
  });
});

describe('todayMenu', () => {
  it('holds Message, Assign and Open client', () => {
    expect(todayMenu('c1')).toEqual([
      { label: 'Message', href: '/messages/c1' },
      { label: 'Assign', href: '/clients/c1/training' },
      { label: 'Open client', href: '/clients/c1' },
    ]);
  });
});

describe('trainingNow', () => {
  const NOW = Date.parse('2026-11-07T10:00:00Z');
  const log = (id: string, clientId: string, startedMinAgo: number, idleMinAgo = 0): LiveLog => ({
    id,
    clientId,
    name: 'W',
    startedAt: new Date(NOW - startedMinAgo * 60_000).toISOString(),
    lastActivityAt: new Date(NOW - idleMinAgo * 60_000).toISOString(),
    done: 1,
    total: 4,
  });

  it('keeps current clients, one card each (latest start), earliest first, and drops long-idle ones', () => {
    const cards = trainingNow(
      [log('a', 'c1', 30), log('b', 'c2', 50), log('old', 'c1', 600, 400), log('gone', 'past', 10), log('stale', 'c3', 300, 200)],
      new Set(['c1', 'c2', 'c3']),
      NOW,
    );
    expect(cards.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('counts whole minutes since the start', () => {
    expect(minutesSince(new Date(NOW - 32.9 * 60_000).toISOString(), NOW)).toBe(32);
    expect(minutesSince(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
  });
});
