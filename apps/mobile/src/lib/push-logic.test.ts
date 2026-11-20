import { describe, expect, it } from 'vitest';
import { PUSH_CARD_SNOOZE_MS, afterPushDismiss, badgeTotal, openPushTarget, pushCardText, pushCardSnoozeKey, pushDataOf, showPushCard, tapTarget, unreadCommentCount } from './push-logic';

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
  it('opens a valid route', () => expect(tapTarget({ route: '/food', type: 'meal_comment' }, new Set())).toBe('/food'));
  it('a message opens the Coach tab, which is the chat', () =>
    expect(tapTarget({ route: '/coach', type: 'message' }, new Set())).toBe('/coach'));
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

describe('showPushCard', () => {
  it('shows only while undetermined', () => {
    expect(showPushCard({ permission: 'undetermined', snoozedUntil: null, now: 0 })).toBe(true);
    expect(showPushCard({ permission: 'granted', snoozedUntil: null, now: 0 })).toBe(false);
    expect(showPushCard({ permission: 'denied', snoozedUntil: null, now: 0 })).toBe(false);
    expect(showPushCard({ permission: null, snoozedUntil: null, now: 0 })).toBe(false);
  });
  it('Later hides it for 7 days', () => {
    expect(PUSH_CARD_SNOOZE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(showPushCard({ permission: 'undetermined', snoozedUntil: PUSH_CARD_SNOOZE_MS, now: PUSH_CARD_SNOOZE_MS - 1 })).toBe(false);
    expect(showPushCard({ permission: 'undetermined', snoozedUntil: PUSH_CARD_SNOOZE_MS, now: PUSH_CARD_SNOOZE_MS })).toBe(true);
  });
  it('shows for a new client too (approved new-client board)', () =>
    expect(showPushCard({ permission: 'undetermined', snoozedUntil: null, now: 0 })).toBe(true));
  it('never again after the second "Not now"', () => {
    const first = afterPushDismiss(0, 0);
    expect(first).toEqual({ dismissals: 1, snoozedUntil: PUSH_CARD_SNOOZE_MS });
    expect(showPushCard({ permission: 'undetermined', ...first, now: PUSH_CARD_SNOOZE_MS })).toBe(true);
    const second = afterPushDismiss(first.dismissals, PUSH_CARD_SNOOZE_MS);
    expect(showPushCard({ permission: 'undetermined', ...second, now: PUSH_CARD_SNOOZE_MS * 10 })).toBe(false);
  });
  it('snooze key per user', () => expect(pushCardSnoozeKey('u1')).toBe('caltracker.pushCardSnoozedUntil.u1'));
});

describe('pushCardText', () => {
  it('names the coach by first name', () => expect(pushCardText('Luis Bueno')).toBe('Get a ping from Luis'));
  it('"your coach" when the name is unknown', () => {
    expect(pushCardText(null)).toBe('Get a ping from your coach');
    expect(pushCardText('  ')).toBe('Get a ping from your coach');
  });
});

describe('openPushTarget', () => {
  it('moves to the one chat instead of stacking another', () => expect(openPushTarget('/coach', '/coach/about')).toBe('navigate'));
  it('does nothing when the chat is already open', () => expect(openPushTarget('/coach', '/coach')).toBeNull());
  it('pushes every other screen as before', () => {
    expect(openPushTarget(`/log/${L}/summary`, '/coach')).toBe('push');
    expect(openPushTarget('/food', '/today')).toBe('push');
  });
});
