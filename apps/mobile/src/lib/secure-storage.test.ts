import * as aesjs from 'aes-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const asyncStore = new Map<string, string>();
const secureStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(asyncStore.get(k) ?? null),
    setItem: (k: string, v: string) => Promise.resolve(void asyncStore.set(k, v)),
    removeItem: (k: string) => Promise.resolve(void asyncStore.delete(k)),
  },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: (k: string) => Promise.resolve(secureStore.get(k) ?? null),
  setItemAsync: (k: string, v: string) => Promise.resolve(void secureStore.set(k, v)),
  deleteItemAsync: (k: string) => Promise.resolve(void secureStore.delete(k)),
}));
let counter = 0;
vi.mock('expo-crypto', () => ({
  // Deterministic but different on every call.
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + ++counter) % 256),
}));

import { largeSecureStore } from './secure-storage';

beforeEach(() => {
  asyncStore.clear();
  secureStore.clear();
});

describe('largeSecureStore', () => {
  it('round-trips a value larger than the SecureStore limit', async () => {
    const value = JSON.stringify({ access_token: 'x'.repeat(5000) });
    await largeSecureStore.setItem('session', value);
    expect(await largeSecureStore.getItem('session')).toBe(value);
    expect(asyncStore.get('session')).not.toContain('access_token');
  });

  it('uses a fresh key for every write', async () => {
    await largeSecureStore.setItem('session', 'one');
    const first = secureStore.get('session');
    const firstCipher = asyncStore.get('session');
    await largeSecureStore.setItem('session', 'one');
    expect(secureStore.get('session')).not.toBe(first);
    expect(asyncStore.get('session')).not.toBe(firstCipher);
    expect(await largeSecureStore.getItem('session')).toBe('one');
  });

  it('still reads a value written by the old scheme (plain hex, one stored key)', async () => {
    const keyHex = 'ab'.repeat(32);
    secureStore.set('session', keyHex);
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
    asyncStore.set('session', aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes('{"legacy":true}'))));
    expect(await largeSecureStore.getItem('session')).toBe('{"legacy":true}');
    // The next write upgrades it to the new format.
    await largeSecureStore.setItem('session', 'new');
    expect(asyncStore.get('session')?.startsWith('v2:')).toBe(true);
    expect(await largeSecureStore.getItem('session')).toBe('new');
  });

  it('returns null (signed out) when the key is gone or the data is corrupt, without throwing', async () => {
    await largeSecureStore.setItem('session', 'value');
    secureStore.delete('session');
    expect(await largeSecureStore.getItem('session')).toBeNull();

    await largeSecureStore.setItem('session', 'value');
    secureStore.set('session', 'cd'.repeat(32)); // wrong key
    expect(await largeSecureStore.getItem('session')).toBeNull();

    secureStore.set('session', 'ab'.repeat(32));
    asyncStore.set('session', 'v2:not-hex!!');
    expect(await largeSecureStore.getItem('session')).toBeNull();
  });

  it('removeItem clears both stores', async () => {
    await largeSecureStore.setItem('session', 'value');
    await largeSecureStore.removeItem('session');
    expect(asyncStore.has('session')).toBe(false);
    expect(secureStore.has('session')).toBe(false);
    expect(await largeSecureStore.getItem('session')).toBeNull();
  });
});
