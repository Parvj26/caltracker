import { describe, expect, it } from 'vitest';
import { parsePushData } from '../../src/push/data';
import type { ServerPushType } from '../../src/push/data';
import { groupOutbox } from '../../src/push/group';
import type { OutboxGroup, OutboxRowInput } from '../../src/push/group';
import { pushText } from '../../src/push/text';

const U = '00000000-0000-4000-8000-000000000001';
const W = '11111111-1111-4111-8111-111111111111';
const L = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const M = '55555555-5555-4555-8555-555555555555';
const N = '66666666-6666-4666-8666-666666666666';

let seq = 0;
const row = (type: ServerPushType, data: unknown, groupKey = `${type}:k`): OutboxRowInput => {
  seq += 1;
  return { id: `r${seq}`, userId: U, type, groupKey, data, createdAt: new Date(Date.UTC(2026, 10, 9, 10, seq)).toISOString() };
};
const groupOf = (rows: OutboxRowInput[]): OutboxGroup => {
  const { groups, invalid } = groupOutbox(rows);
  expect(invalid).toEqual([]);
  expect(groups).toHaveLength(1);
  return groups[0]!;
};
const one = (type: ServerPushType, data: unknown) => groupOf([row(type, data)]);
const msgs = (n: number) => groupOf(Array.from({ length: n }, () => row('message', { actorName: 'Luis', conversationId: C })));
const actorId = (i: number) => `10000000-0000-4000-8000-00000000000${i}`;
const activity = (kind: 'reaction' | 'comment') => (names: string[]) =>
  groupOf(
    names.map((actorName, i) =>
      row('community_activity', { actorId: actorId(i), actorName, postId: P, activity: kind, notificationId: N }, `community_activity:${kind}:${P}`),
    ),
  );
const reactions = activity('reaction');
const comments = activity('comment');

describe('pushText', () => {
  it.each<[ServerPushType, unknown, string, string]>([
    ['workout_assigned', { actorName: 'Luis', name: 'Strength Block' }, 'New workout assigned', 'Luis assigned you Strength Block.'],
    ['workout_changed', { actorName: 'Luis', workoutId: W, workoutName: 'Upper A' }, "Today's workout changed", 'Luis updated Upper A.'],
    ['daily_reminder', { workoutId: W, workoutName: 'Upper A', more: 0 }, 'Today: Upper A', 'Your workout is ready. Tap to start.'],
    ['daily_reminder', { workoutId: W, workoutName: 'Upper A', more: 1 }, 'Today: Upper A + 1 more', 'Your workout is ready. Tap to start.'],
    ['coach_logged', { actorName: 'Luis', logId: L }, 'Luis logged your session', 'Your sticker is waiting.'],
    ['message', { actorName: 'Luis', conversationId: C }, 'Message from Luis', 'Luis sent you a message.'],
    ['workout_comment', { actorName: 'Luis', logId: L, workoutName: 'Upper A' }, 'Comment on your workout', 'Luis commented on Upper A.'],
    ['meal_comment', { actorName: 'Luis', mealId: M, mealName: 'lunch' }, 'Comment on your meal', 'Luis commented on your lunch.'],
    ['food_targets', { actorName: 'Luis' }, 'New food targets', 'Luis updated your daily targets.'],
    [
      'community_coach_post',
      { actorName: 'Luis', postId: P, communityName: 'Luis Bueno Coaching' },
      'Community',
      'Luis posted in Luis Bueno Coaching.',
    ],
  ])('%s text', (type, data, title, body) => expect(pushText(one(type, data))).toEqual({ title, body }));

  it('three messages', () => expect(pushText(msgs(3)).body).toBe('Luis sent you 3 messages.'));

  it('community reactions', () => {
    expect(pushText(reactions(['Sam'])).body).toBe('Sam reacted to your post.');
    expect(pushText(reactions(['Sam', 'Ana'])).body).toBe('Sam and 1 other reacted to your post.');
    expect(pushText(reactions(['Sam', 'Ana', 'Bo', 'Cy', 'Di'])).body).toBe('Sam and 4 others reacted to your post.');
    expect(pushText(comments(['Sam', 'Ana'])).body).toBe('Sam and 1 other commented on your post.');
    expect(pushText(comments(['Sam'])).title).toBe('Community');
  });

  it('counts people, not reactions', () => {
    const g = groupOf([
      row('community_activity', { actorId: actorId(1), actorName: 'Sam', postId: P, activity: 'reaction', notificationId: N }, 'k'),
      row('community_activity', { actorId: actorId(1), actorName: 'Sam', postId: P, activity: 'reaction', notificationId: N }, 'k'),
    ]);
    expect(pushText(g).body).toBe('Sam reacted to your post.');
  });

  it('empty coach name falls back', () => {
    expect(pushText(one('message', { actorName: '', conversationId: C }))).toEqual({
      title: 'Message from your coach',
      body: 'Your coach sent you a message.',
    });
    expect(pushText(one('coach_logged', { actorName: ' ', logId: L }))).toEqual({
      title: 'Your coach logged your session',
      body: 'Your sticker is waiting.',
    });
    expect(pushText(one('food_targets', { actorName: '' })).body).toBe('Your coach updated your daily targets.');
  });

  it('empty member name falls back to Someone', () => expect(pushText(reactions([''])).body).toBe('Someone reacted to your post.'));

  it('never includes content', () => {
    const fullMessageData = { actorName: 'Luis', conversationId: C, body: 'Your weigh-in was 82 kg', weightKg: 82 };
    expect(Object.keys(parsePushData('message', fullMessageData)!)).toEqual(['actorName', 'conversationId']);
    expect(JSON.stringify(pushText(one('message', fullMessageData)))).not.toContain('82');
  });
});
