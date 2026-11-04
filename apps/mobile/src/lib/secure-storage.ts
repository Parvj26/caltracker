// Session storage for Supabase Auth.
// SecureStore (Keychain/Keystore) holds only ~2 KB per value and a Supabase session can be larger,
// so we use Supabase's documented "LargeSecureStore" pattern: a random AES-256 key lives in
// SecureStore, and the AES-CTR encrypted session lives in AsyncStorage.
//
// Every write uses a FRESH random key. AES-CTR with a fixed counter start is a stream cipher, so reusing one key
// for two different sessions would leak the XOR of the plaintexts. Format of what we write:
//   `v2:` + hex(AES-CTR(key, 'ok:' + value))   (the `ok:` marker detects a key/ciphertext mismatch)
// Values written by the earlier version (plain hex, no prefix, one long-lived key) are still readable, because the
// key is looked up in SecureStore under the same name either way.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const V2_PREFIX = 'v2:';
const PLAINTEXT_MARKER = 'ok:';

const toHex = (bytes: Uint8Array) => aesjs.utils.hex.fromBytes(bytes);

function aes(keyHex: string) {
  return new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
}

async function encrypt(key: string, value: string): Promise<string> {
  const keyBytes = getRandomBytes(32);
  const keyHex = toHex(keyBytes);
  // Write the key first: a ciphertext without its key is unreadable (signed out), never a wrong-key read.
  await SecureStore.setItemAsync(key, keyHex);
  const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(1));
  return V2_PREFIX + toHex(cipher.encrypt(aesjs.utils.utf8.toBytes(PLAINTEXT_MARKER + value)));
}

/** Returns the stored value, or null when it cannot be read (the app then simply shows signed-out). */
async function decrypt(key: string, stored: string): Promise<string | null> {
  try {
    const keyHex = await SecureStore.getItemAsync(key);
    if (!keyHex) return null;
    const isV2 = stored.startsWith(V2_PREFIX);
    const hex = isV2 ? stored.slice(V2_PREFIX.length) : stored;
    const text = aesjs.utils.utf8.fromBytes(aes(keyHex).decrypt(aesjs.utils.hex.toBytes(hex)));
    if (!isV2) return text; // legacy value
    return text.startsWith(PLAINTEXT_MARKER) ? text.slice(PLAINTEXT_MARKER.length) : null;
  } catch {
    return null;
  }
}

export const largeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return decrypt(key, encrypted);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await encrypt(key, value));
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};
