import { describe, expect, it } from 'vitest';
import { newestInviteFirst } from './pending-order';

describe('newestInviteFirst', () => {
  it('puts the most recently created invite first, whatever the names', () => {
    const invites = [
      { email: 'a@x.com', created_at: '2026-11-01T10:00:00Z' },
      { email: 'c@x.com', created_at: '2026-11-03T10:00:00Z' },
      { email: 'b@x.com', created_at: '2026-11-02T10:00:00Z' },
    ];
    expect([...invites].sort(newestInviteFirst).map((i) => i.email)).toEqual(['c@x.com', 'b@x.com', 'a@x.com']);
  });

  it('files invites without a created_at last', () => {
    const invites = [
      { email: 'none@x.com', created_at: null },
      { email: 'old@x.com', created_at: '2026-11-01T10:00:00Z' },
    ];
    expect([...invites].sort(newestInviteFirst).map((i) => i.email)).toEqual(['old@x.com', 'none@x.com']);
  });
});
