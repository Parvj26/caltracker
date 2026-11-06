import { describe, expect, it } from 'vitest';
import { mergeOutbox } from '../../src/messages/outbox';
import type { Message, OutboxItem } from '../../src/messages/types';

const srv = (id: string, clientMsgId: string, createdAt: string): Message => ({
  id,
  senderId: 'me',
  body: id,
  imagePaths: [],
  clientMsgId,
  createdAt,
});
const out = (clientMsgId: string, createdAt: string, state: OutboxItem['state'] = 'sending'): OutboxItem => ({
  clientMsgId,
  body: clientMsgId,
  imagePaths: [],
  createdAt,
  state,
});

describe('mergeOutbox', () => {
  it('drops outbox items the server already has', () => {
    const merged = mergeOutbox([srv('s1', 'c1', '2026-11-01T10:00:00Z')], [out('c1', '2026-11-01T09:59:59Z')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 's1' });
  });
  it('orders by createdAt with outbox items after server ones at equal times', () => {
    const merged = mergeOutbox(
      [srv('s1', 'c1', '2026-11-01T10:00:00Z'), srv('s2', 'c2', '2026-11-01T12:00:00Z')],
      [out('c3', '2026-11-01T11:00:00Z', 'failed'), out('c4', '2026-11-01T12:00:00Z')],
    );
    expect(merged.map((x) => x.clientMsgId)).toEqual(['c1', 'c3', 'c2', 'c4']);
  });
  it('handles empty inputs', () => {
    expect(mergeOutbox([], [])).toEqual([]);
  });
});
