import { describe, expect, it } from 'vitest';
import { shouldMarkRead, type ReadState } from './read-rules';

const base: ReadState = { viewing: true, appActive: true, conversationId: 'c', latestFromCoach: '2026-11-05T10:00:00Z', myReadAt: null };

describe('shouldMarkRead', () => {
  it('marks read when the tab is on screen in the foreground with unread coach messages', () => {
    expect(shouldMarkRead(base)).toBe(true);
    expect(shouldMarkRead({ ...base, myReadAt: '2026-11-05T09:00:00Z' })).toBe(true);
  });
  it('does not while the app is in the background or locked, even with the tab selected', () => {
    expect(shouldMarkRead({ ...base, appActive: false })).toBe(false);
  });
  it('does not while another tab is showing', () => {
    expect(shouldMarkRead({ ...base, viewing: false })).toBe(false);
  });
  it('does not when everything is already read, or there is nothing from the coach', () => {
    expect(shouldMarkRead({ ...base, myReadAt: '2026-11-05T10:00:00Z' })).toBe(false);
    expect(shouldMarkRead({ ...base, latestFromCoach: null })).toBe(false);
    expect(shouldMarkRead({ ...base, conversationId: null })).toBe(false);
  });
});
