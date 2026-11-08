import { describe, expect, it } from 'vitest';
import { countDoneSets, routeTaskSteps } from './route-tasks';

describe('routeTaskSteps', () => {
  it('starts joining on the invite screen and finishes it on Today', () => {
    expect(routeTaskSteps('/invite/[token]')).toEqual([{ action: 'start', task: 'join_from_invite' }]);
    expect(routeTaskSteps('/today')).toEqual([{ action: 'complete', task: 'join_from_invite' }]);
  });
  it('finds the workout when a workout or log opens', () => {
    expect(routeTaskSteps('/workout/abc')).toEqual([{ action: 'complete', task: 'find_todays_workout' }]);
    expect(routeTaskSteps('/log/abc')).toEqual([{ action: 'complete', task: 'find_todays_workout' }]);
  });
  it('tracks progress viewing from Progress to the Zoo', () => {
    expect(routeTaskSteps('/progress')).toEqual([{ action: 'start', task: 'view_progress' }]);
    expect(routeTaskSteps('/zoo')).toEqual([{ action: 'complete', task: 'view_progress' }]);
    expect(routeTaskSteps('/food')).toEqual([]);
  });
});

describe('countDoneSets', () => {
  it('counts only sets with a completion time', () => {
    const set = (done: boolean) => ({ completedAt: done ? '2026-11-07T10:00:00Z' : null });
    expect(countDoneSets({ blocks: [{ exercises: [{ sets: [set(true), set(false)] }, { sets: [set(true)] }] }] })).toBe(2);
  });
});
