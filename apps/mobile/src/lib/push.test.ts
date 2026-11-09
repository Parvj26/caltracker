import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setBadgeCountAsync } = vi.hoisted(() => ({ setBadgeCountAsync: vi.fn(() => Promise.resolve(true)) }));
vi.mock('expo-notifications', () => ({ setBadgeCountAsync }));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./supabase', () => ({ supabase: {} }));

import { setBadge } from './push';

beforeEach(() => setBadgeCountAsync.mockClear());

describe('setBadge', () => {
  it('sets the badge every time, even to the same number (a push sets the icon badge behind the app’s back)', () => {
    setBadge(2);
    setBadge(2);
    setBadge(0);
    expect(setBadgeCountAsync.mock.calls).toEqual([[2], [2], [0]]);
  });
});
