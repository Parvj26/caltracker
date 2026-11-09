import { describe, expect, it } from 'vitest';
import type { PushData, ServerPushType } from '../../src/push/data';
import { parsePushData } from '../../src/push/data';
import { isPushRoute, routeFor } from '../../src/push/routes';

const W = '11111111-1111-4111-8111-111111111111';
const L = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const M = '55555555-5555-4555-8555-555555555555';
const N = '66666666-6666-4666-8666-666666666666';

const base: { [T in ServerPushType]: PushData[T] } = {
  workout_assigned: { actorName: 'Luis', name: 'Strength Block' },
  workout_changed: { actorName: 'Luis', workoutId: W, workoutName: 'Upper A' },
  daily_reminder: { workoutId: W, workoutName: 'Upper A', more: 0 },
  coach_logged: { actorName: 'Luis', logId: L },
  message: { actorName: 'Luis', conversationId: C },
  workout_comment: { actorName: 'Luis', logId: L, workoutName: 'Upper A' },
  meal_comment: { actorName: 'Luis', mealId: M, mealName: 'lunch' },
  food_targets: { actorName: 'Luis' },
  community_coach_post: { actorName: 'Luis', postId: P, communityName: 'Luis Bueno Coaching' },
  community_activity: { actorId: W, actorName: 'Sam', postId: P, activity: 'reaction', notificationId: N },
};

describe('routeFor', () => {
  it.each<[ServerPushType, string]>([
    ['workout_assigned', '/workouts'],
    ['workout_changed', `/workout/${W}`],
    ['daily_reminder', '/today'],
    ['coach_logged', `/log/${L}/summary`],
    ['message', '/coach'],
    ['workout_comment', `/log/${L}/summary`],
    ['meal_comment', '/food'],
    ['food_targets', '/food'],
    ['community_coach_post', `/community/${P}`],
    ['community_activity', `/community/${P}`],
  ])('%s opens %s', (type, route) => {
    expect(routeFor(type, base[type])).toBe(route);
    expect(isPushRoute(route)).toBe(true);
  });
});

describe('isPushRoute', () => {
  it('accepts only these shapes', () => {
    expect(isPushRoute(`/workout/${W}`)).toBe(true);
    expect(isPushRoute(`/log/${L}/summary`)).toBe(true);
    expect(isPushRoute('/today')).toBe(true);
    expect(isPushRoute('/workout/../auth')).toBe(false);
    expect(isPushRoute('https://evil.example')).toBe(false);
    expect(isPushRoute(`/workout/${W}/edit`)).toBe(false);
    expect(isPushRoute('/settings')).toBe(false);
    expect(isPushRoute(42)).toBe(false);
    expect(isPushRoute(undefined)).toBe(false);
  });
});

describe('parsePushData', () => {
  it('accepts every type’s shape', () => {
    for (const type of Object.keys(base) as ServerPushType[]) expect(parsePushData(type, base[type])).toEqual(base[type]);
  });
  it('rejects a wrong shape', () => expect(parsePushData('message', { actorName: 'Luis' })).toBeNull());
  it('rejects ids that are not uuids', () =>
    expect(parsePushData('workout_changed', { actorName: 'Luis', workoutId: '../auth', workoutName: 'x' })).toBeNull());
  it('rejects non-objects', () => expect(parsePushData('food_targets', null)).toBeNull());
});
