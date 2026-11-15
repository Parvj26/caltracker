import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ error: null }>>(() => Promise.resolve({ error: null })),
  secret: null as string | null,
}));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: () => Promise.resolve({ granted: true, status: 'granted' }),
  getDevicePushTokenAsync: () => Promise.resolve({ data: 'AB'.repeat(32) }),
  PermissionStatus: { UNDETERMINED: 'undetermined' },
}));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '2.1.0' }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('./device-secret', () => ({ deviceSecret: () => Promise.resolve(h.secret) }));

import { registerDevice, registerErrorMessage } from './push';

beforeEach(() => h.rpc.mockClear());

describe('registerDevice', () => {
  it('sends the install secret with the token', async () => {
    h.secret = 'c'.repeat(64);
    await registerDevice();
    expect(h.rpc).toHaveBeenCalledWith('register_push_device', { p_token: 'ab'.repeat(32), p_app_version: '2.1.0', p_secret: 'c'.repeat(64) });
  });

  it('without a secret (Keychain unavailable) sends what an older build sends', async () => {
    h.secret = null;
    await registerDevice();
    expect(h.rpc).toHaveBeenCalledWith('register_push_device', { p_token: 'ab'.repeat(32), p_app_version: '2.1.0' });
  });
});

describe('registerErrorMessage', () => {
  it('names the likely cause when the token is tied to another install', () => {
    const e = { code: '42501', message: 'this push token belongs to another device' };
    expect(registerErrorMessage(e, true)).toMatch(/tied to another install's secret \(this install sent a different one\)/);
    expect(registerErrorMessage(e, false)).toMatch(/sent none/);
  });

  it('passes other errors through', () => {
    expect(registerErrorMessage({ code: '42501', message: 'not signed in' }, true)).toBe('not signed in');
  });
});
