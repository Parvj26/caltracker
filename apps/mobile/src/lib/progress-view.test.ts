import { describe, expect, it } from 'vitest';
import { streakNow } from './progress-view';

// Thursday 5 November 2026: this week starts Monday 2 November.
const today = '2026-11-05';
const stats = { workouts: 9, streak: 5, streakWeek: '2026-10-26', bestStreak: 7, journeyWeek: 5, prCount: 3, lifetimeVolumeKg: 1000 };

describe('streakNow', () => {
  it('uses the stored streak as it stands this week, and the stored best', () => {
    expect(streakNow(stats, [], today)).toEqual({ current: 5, best: 7 });
    expect(streakNow({ ...stats, streakWeek: '2026-10-12' }, [], today)).toEqual({ current: 0, best: 7 });
  });
  it('works it out from the finished workouts when nothing is stored yet', () => {
    expect(streakNow(null, ['2026-10-27', '2026-11-03'], today)).toEqual({ current: 2, best: 2 });
  });
});
