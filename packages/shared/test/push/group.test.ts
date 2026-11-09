import { describe, expect, it } from 'vitest';
import { groupOutbox } from '../../src/push/group';
import type { OutboxRowInput } from '../../src/push/group';

const U = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const P = '33333333-3333-4333-8333-333333333333';
const N = '66666666-6666-4666-8666-666666666666';
const C = '44444444-4444-4444-8444-444444444444';
const ACTORS: Record<string, string> = {
  Sam: '10000000-0000-4000-8000-000000000001',
  Ana: '10000000-0000-4000-8000-000000000002',
};
const SAM = ACTORS.Sam;
const ANA = ACTORS.Ana;
const t1 = '2026-11-09T10:00:00Z';
const t2 = '2026-11-09T10:01:00Z';
const t3 = '2026-11-09T10:02:00Z';

const react = (id: string, name: string, createdAt: string, userId = U): OutboxRowInput => ({
  id,
  userId,
  type: 'community_activity',
  groupKey: `community_activity:reaction:${P}`,
  data: { actorId: ACTORS[name], actorName: name, postId: P, activity: 'reaction', notificationId: N },
  createdAt,
});
const message = (id: string, createdAt: string, userId = U): OutboxRowInput => ({
  id,
  userId,
  type: 'message',
  groupKey: `message:${C}`,
  data: { actorName: 'Luis', conversationId: C },
  createdAt,
});

describe('groupOutbox', () => {
  it('groups by user and key, newest data, distinct actors', () => {
    const other = message('m', '2026-11-09T09:00:00Z');
    const { groups, invalid } = groupOutbox([react('c', 'Sam', t3), react('a', 'Sam', t1), react('b', 'Ana', t2), other]);
    expect(invalid).toEqual([]);
    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({
      ids: ['a', 'b', 'c'],
      userId: U,
      type: 'community_activity',
      count: 3,
      firstActorName: 'Sam',
      actorIds: [SAM, ANA],
      createdAt: t1,
    });
    expect(groups[1]!.data).toMatchObject({ actorName: 'Sam', actorId: SAM });
  });

  it('orders groups by their oldest row', () => {
    const { groups } = groupOutbox([react('a', 'Sam', t2), message('m', t1)]);
    expect(groups.map((g) => g.type)).toEqual(['message', 'community_activity']);
  });

  it('keeps the newest row’s data', () => {
    const newer = { ...message('n', t3), data: { actorName: 'Luis B', conversationId: C } };
    const { groups } = groupOutbox([message('o', t1), newer]);
    expect(groups[0]).toMatchObject({ count: 2, firstActorName: 'Luis', data: { actorName: 'Luis B' } });
  });

  it('never mixes users', () => {
    const { groups } = groupOutbox([message('a', t1, U), message('b', t2, U2)]);
    expect(groups.map((g) => g.ids)).toEqual([['a'], ['b']]);
  });

  it('puts malformed rows aside', () => {
    const bad: OutboxRowInput = { ...message('bad', t1), data: { actorName: 'Luis' } };
    const { groups, invalid } = groupOutbox([bad, message('ok', t2)]);
    expect(invalid).toEqual(['bad']);
    expect(groups.map((g) => g.ids)).toEqual([['ok']]);
  });

  it('handles no rows', () => expect(groupOutbox([])).toEqual({ groups: [], invalid: [] }));
});
