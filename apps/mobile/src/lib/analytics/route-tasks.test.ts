import { describe, expect, it } from 'vitest';
import { countDoneSets, routeTaskSteps } from './route-tasks';

describe('routeTaskSteps', () => {
  it('starts joining on the invite screen and finishes it on Today', () => {
    expect(routeTaskSteps('/invite/[token]')).toContainEqual({ action: 'start', task: 'join_from_invite' });
    expect(routeTaskSteps('/today')).toContainEqual({ action: 'complete', task: 'join_from_invite' });
  });
  it('finds the workout when a workout or log opens', () => {
    expect(routeTaskSteps('/workout/abc')).toContainEqual({ action: 'complete', task: 'find_todays_workout' });
    expect(routeTaskSteps('/log/abc')).toContainEqual({ action: 'complete', task: 'find_todays_workout' });
  });
  it('tracks progress viewing from Progress to the Zoo', () => {
    expect(routeTaskSteps('/progress')).toContainEqual({ action: 'start', task: 'view_progress' });
    expect(routeTaskSteps('/zoo')).toContainEqual({ action: 'complete', task: 'view_progress' });
    expect(routeTaskSteps('/food').filter((s) => s.action !== 'abandon')).toEqual([]);
  });
});

describe('routeTaskSteps leaving a task', () => {
  it('abandons finding the workout when the client goes elsewhere', () => {
    expect(routeTaskSteps('/coach')).toContainEqual({ action: 'abandon', task: 'find_todays_workout' });
    expect(routeTaskSteps('/today')).not.toContainEqual({ action: 'abandon', task: 'find_todays_workout' });
    expect(routeTaskSteps('/workouts')).not.toContainEqual({ action: 'abandon', task: 'find_todays_workout' });
  });
  it('abandons progress viewing when leaving Progress for anything but the Zoo', () => {
    expect(routeTaskSteps('/today')).toContainEqual({ action: 'abandon', task: 'view_progress' });
    expect(routeTaskSteps('/zoo')).not.toContainEqual({ action: 'abandon', task: 'view_progress' });
    expect(routeTaskSteps('/progress')).not.toContainEqual({ action: 'abandon', task: 'view_progress' });
  });
});

describe('countDoneSets', () => {
  it('counts only sets with a completion time', () => {
    const set = (done: boolean) => ({ completedAt: done ? '2026-11-07T10:00:00Z' : null });
    expect(countDoneSets({ blocks: [{ exercises: [{ sets: [set(true), set(false)] }, { sets: [set(true)] }] }] })).toBe(2);
  });
});
