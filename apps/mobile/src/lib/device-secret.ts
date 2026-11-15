// A random secret made once per app install and kept in the iOS Keychain. It is sent with every push-token register,
// so the server moves this phone's token to a new account only when the caller proves it is this install
// (supabase/migrations/20261114000100_push_device_secret.sql). Anyone who merely learns the token cannot take it.
// It is per install, not per user: signing out and in as someone else on the same phone keeps the same secret.
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export const DEVICE_SECRET_KEY = 'push-device-secret';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

let cached: string | null = null;

/**
 * This install's secret (64 hex characters), made and saved on first use. Returns null when the Keychain cannot be
 * read or written: the register then goes ahead without a secret, as an older build would.
 */
export async function deviceSecret(): Promise<string | null> {
  if (cached) return cached;
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
    if (stored) return (cached = stored);
    const made = toHex(getRandomBytes(32));
    // AFTER_FIRST_UNLOCK: iOS can hand out a new token while the app is in the background.
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, made, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return (cached = made);
  } catch (e) {
    console.warn(`[push] device secret: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Test hook: forget the in-memory copy. */
export function resetDeviceSecretCache(): void {
  cached = null;
}
