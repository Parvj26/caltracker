import { describe, expect, it } from 'vitest';
import { badgeTotal, pushDataOf, tapTarget, unreadCommentCount } from './push-logic';

const L = '0b6f1c2e-6d0a-4a51-9f3e-2a7c1d9e8b40';

describe('badgeTotal', () => {
  it('adds unread messages and comment notifications', () => {
    expect(badgeTotal(2, 1)).toBe(3);
    expect(badgeTotal(0, 0)).toBe(0);
  });
  it('never goes negative', () => expect(badgeTotal(-1, 0)).toBe(0));
});

describe('unreadCommentCount', () => {
  it('counts unread comment notifications only (as the server badge does)', () => {
    const row = (kind: 'comment' | 'reaction', readAt: string | null) => ({ kind, readAt });
    expect(unreadCommentCount([row('comment', null), row('comment', '2026-11-09T10:00:00Z'), row('reaction', null)])).toBe(1);
  });
});

describe('tapTarget', () => {
  it('opens a valid route', () => expect(tapTarget({ route: '/coach', type: 'message' }, new Set())).toBe('/coach'));
  it('ignores foreign routes', () => expect(tapTarget({ route: 'https://x.y' }, new Set())).toBeNull());
  it('ignores the local still-training reminder', () => expect(tapTarget({ kind: 'reminder', logId: L }, new Set())).toBeNull());
  it('ignores anything that is not an object', () => {
    expect(tapTarget(null, new Set())).toBeNull();
    expect(tapTarget('/coach', new Set())).toBeNull();
  });
  it('coach_logged opens the reveal once', () => {
    expect(tapTarget({ route: `/log/${L}/summary`, type: 'coach_logged' }, new Set())).toBe(`/log/${L}/reveal?coach=1`);
    expect(tapTarget({ route: `/log/${L}/summary`, type: 'coach_logged' }, new Set([L]))).toBe(`/log/${L}/summary`);
  });
  it('a workout comment opens the summary, never the reveal', () =>
    expect(tapTarget({ route: `/log/${L}/summary`, type: 'workout_comment' }, new Set())).toBe(`/log/${L}/summary`));
});

describe('pushDataOf', () => {
  it('reads the custom keys of an APNs payload wherever the platform put them', () => {
    expect(pushDataOf({ route: '/coach', type: 'message' }, null)).toEqual({ route: '/coach', type: 'message' });
    expect(pushDataOf({}, { aps: {}, route: '/food', type: 'food_targets' })).toEqual({ aps: {}, route: '/food', type: 'food_targets' });
    expect(pushDataOf({ body: { route: '/today' } }, null)).toEqual({ route: '/today' });
  });
  it('keeps local notification data as it is', () =>
    expect(pushDataOf({ kind: 'reminder', logId: L }, null)).toEqual({ kind: 'reminder', logId: L }));
  it('null when there is nothing', () => expect(pushDataOf(undefined, undefined)).toBeNull());
});
