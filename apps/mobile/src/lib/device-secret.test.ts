import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
const fail = vi.hoisted(() => ({ get: false, set: false }));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afu',
  getItemAsync: vi.fn((k: string) => (fail.get ? Promise.reject(new Error('locked')) : Promise.resolve(store.get(k) ?? null))),
  setItemAsync: vi.fn((k: string, v: string) => {
    if (fail.set) return Promise.reject(new Error('full'));
    store.set(k, v);
    return Promise.resolve();
  }),
}));
let n = 0;
vi.mock('expo-crypto', () => ({ getRandomBytes: (len: number) => new Uint8Array(len).fill(++n) }));

import { DEVICE_SECRET_KEY, deviceSecret, resetDeviceSecretCache } from './device-secret';

beforeEach(() => {
  store.clear();
  fail.get = false;
  fail.set = false;
  resetDeviceSecretCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('deviceSecret', () => {
  it('makes a 64-hex secret once and saves it in the Keychain', async () => {
    const s = await deviceSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get(DEVICE_SECRET_KEY)).toBe(s);
  });

  it('returns the same secret on later launches (survives sign-out: it is per install)', async () => {
    const first = await deviceSecret();
    resetDeviceSecretCache();
    expect(await deviceSecret()).toBe(first);
  });

  it('returns null (register like an old build) when the Keychain cannot be read, without making a new secret', async () => {
    store.set(DEVICE_SECRET_KEY, 'f'.repeat(64));
    fail.get = true;
    expect(await deviceSecret()).toBeNull();
    expect(store.get(DEVICE_SECRET_KEY)).toBe('f'.repeat(64));
  });

  it('returns null when the new secret cannot be saved', async () => {
    fail.set = true;
    expect(await deviceSecret()).toBeNull();
  });
});
