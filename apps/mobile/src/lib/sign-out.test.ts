import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getAllKeys: () => Promise.resolve([]), multiRemove: () => Promise.resolve() },
}));
vi.mock('./exercise-index', () => ({ forgetIndexUser: () => Promise.resolve() }));
vi.mock('./analytics/client', () => ({ resetAnalytics: () => undefined }));
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
      signOut: () => {
        calls.push('signOut');
        return Promise.resolve({ error: null });
      },
    },
  },
}));
vi.mock('./push', () => ({
  unregisterDevice: () => {
    calls.push('unregister');
    return new Promise<void>(() => undefined); // never settles: no signal
  },
  setBadge: () => undefined,
}));

import { signOutAndForget } from './sign-out';

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('signOutAndForget', () => {
  it('unregister runs before signOut and never blocks it', async () => {
    const done = signOutAndForget();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toEqual(['unregister']);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(calls).toEqual(['unregister', 'signOut']);
  });
});
