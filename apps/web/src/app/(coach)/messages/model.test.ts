import { describe, expect, it } from 'vitest';
import { badgeText, buildInbox, canSendDraft, filterInbox, previewOf } from './model';

const ME = 'coach';

describe('previewOf', () => {
  it('shows the text on one line', () => {
    expect(previewOf('  hello\n\nthere  ', [])).toBe('hello there');
  });
  it('says Photo for a photo-only message', () => {
    expect(previewOf('', ['w/c/p.webp'])).toBe('📷 Photo');
    expect(previewOf('   ', ['w/c/p.webp'])).toBe('📷 Photo');
  });
  it('prefers the text when there are photos too', () => {
    expect(previewOf('look', ['w/c/p.webp'])).toBe('look');
  });
});

describe('buildInbox', () => {
  const clients = [
    { id: 'a', name: 'Zed' },
    { id: 'b', name: 'Amy' },
    { id: 'c', name: 'Bob' },
    { id: 'd', name: 'Cat' },
  ];
  const conversations = [
    { id: 'ca', clientId: 'a', lastMessageAt: '2026-11-05T10:00:00Z' },
    { id: 'cc', clientId: 'c', lastMessageAt: '2026-11-05T12:00:00Z' },
    { id: 'cd', clientId: 'd', lastMessageAt: null },
  ];
  const latest = new Map([
    ['ca', { body: 'hi coach', imagePaths: [], senderId: 'a' }],
    ['cc', { body: '', imagePaths: ['x'], senderId: ME }],
  ]);
  const recent = new Map([
    ['ca', [{ senderId: 'a', createdAt: '2026-11-05T10:00:00Z' }]],
    ['cc', [{ senderId: ME, createdAt: '2026-11-05T12:00:00Z' }]],
  ]);

  it('puts latest conversations first, then clients without messages by name', () => {
    const rows = buildInbox({ me: ME, clients, conversations, latest, recent, reads: new Map() });
    expect(rows.map((r) => r.clientId)).toEqual(['c', 'a', 'b', 'd']);
    expect(rows[0]).toMatchObject({ preview: '📷 Photo', lastFromMe: true, unread: 0 });
    expect(rows[1]).toMatchObject({ preview: 'hi coach', lastFromMe: false, unread: 1 });
    expect(rows[2]).toMatchObject({ conversationId: null, preview: '', unread: 0 });
  });

  it('stops counting a message once the coach has read past it', () => {
    const rows = buildInbox({ me: ME, clients, conversations, latest, recent, reads: new Map([['ca', '2026-11-05T11:00:00Z']]) });
    expect(rows.find((r) => r.clientId === 'a')!.unread).toBe(0);
  });

  it('uses an override count when given', () => {
    const rows = buildInbox({ me: ME, clients, conversations, latest, recent, reads: new Map(), unreadOverride: new Map([['ca', 7]]) });
    expect(rows.find((r) => r.clientId === 'a')!.unread).toBe(7);
  });
});

describe('filterInbox', () => {
  const rows = buildInbox({
    me: ME,
    clients: [{ id: 'a', name: 'Amy Park' }, { id: 'b', name: 'Bob Lee' }],
    conversations: [{ id: 'ca', clientId: 'a', lastMessageAt: '2026-11-05T10:00:00Z' }],
    latest: new Map([['ca', { body: 'hi', imagePaths: [], senderId: 'a' }]]),
    recent: new Map([['ca', [{ senderId: 'a', createdAt: '2026-11-05T10:00:00Z' }]]]),
    reads: new Map(),
  });
  it('filters by name, ignoring case', () => {
    expect(filterInbox(rows, { unreadOnly: false, query: ' bOb' }).map((r) => r.clientId)).toEqual(['b']);
  });
  it('filters to unread', () => {
    expect(filterInbox(rows, { unreadOnly: true, query: '' }).map((r) => r.clientId)).toEqual(['a']);
  });
});

describe('badgeText', () => {
  it('caps at 99+', () => {
    expect(badgeText(5)).toBe('5');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('canSendDraft', () => {
  const start = 'About your Lunch today (12:15 pm): ';
  it('needs text or a photo', () => {
    expect(canSendDraft('  ', 0)).toBe(false);
    expect(canSendDraft('hi', 0)).toBe(true);
    expect(canSendDraft('', 1)).toBe(true);
  });
  it('refuses only the text the box was started with', () => {
    expect(canSendDraft(start, 0, start)).toBe(false);
    expect(canSendDraft(start.trim(), 0, start)).toBe(false);
    expect(canSendDraft(`${start}nice!`, 0, start)).toBe(true);
    expect(canSendDraft(start, 1, start)).toBe(true);
  });
});
