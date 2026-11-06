import { describe, expect, it } from 'vitest';
import { seenMessageId, unreadCount } from '../../src/messages/state';

const m = (id: string, senderId: string, createdAt: string) => ({ id, senderId, createdAt });

describe('unreadCount', () => {
  const msgs = [
    m('1', 'them', '2026-11-01T10:00:00Z'),
    m('2', 'me', '2026-11-01T11:00:00Z'),
    m('3', 'them', '2026-11-01T12:00:00Z'),
    m('4', 'them', '2026-11-01T13:00:00Z'),
  ];
  it('counts everything from others when never read', () => {
    expect(unreadCount(msgs, 'me', null)).toBe(3);
  });
  it('counts only others messages after last read', () => {
    expect(unreadCount(msgs, 'me', '2026-11-01T12:00:00Z')).toBe(1);
  });
  it('is zero when read up to date, or no messages', () => {
    expect(unreadCount(msgs, 'me', '2026-11-02T00:00:00Z')).toBe(0);
    expect(unreadCount([], 'me', null)).toBe(0);
  });
});

describe('seenMessageId', () => {
  const msgs = [
    m('1', 'me', '2026-11-01T10:00:00Z'),
    m('2', 'them', '2026-11-01T11:00:00Z'),
    m('3', 'me', '2026-11-01T12:00:00Z'),
    m('4', 'me', '2026-11-01T13:00:00Z'),
  ];
  it('is null when they have never read', () => {
    expect(seenMessageId(msgs, 'me', null)).toBeNull();
  });
  it('returns my latest message they have read (inclusive)', () => {
    expect(seenMessageId(msgs, 'me', '2026-11-01T12:00:00Z')).toBe('3');
    expect(seenMessageId(msgs, 'me', '2026-11-01T12:30:00Z')).toBe('3');
  });
  it('is null when none of my messages are read yet', () => {
    expect(seenMessageId(msgs, 'me', '2026-11-01T09:00:00Z')).toBeNull();
  });
  it('works with unordered input', () => {
    expect(seenMessageId([...msgs].reverse(), 'me', '2026-11-01T23:00:00Z')).toBe('4');
  });
});
