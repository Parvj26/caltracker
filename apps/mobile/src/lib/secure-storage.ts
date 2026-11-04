// Session storage for Supabase Auth.
// SecureStore (Keychain/Keystore) holds only ~2 KB per value and a Supabase session can be larger,
// so we use Supabase's documented "LargeSecureStore" pattern: a random AES-256 key lives in
// SecureStore, and the AES-CTR encrypted session lives in AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const toHex = (bytes: Uint8Array) => aesjs.utils.hex.fromBytes(bytes);

async function encrypt(key: string, value: string): Promise<string> {
  const storedKey = await SecureStore.getItemAsync(key);
  let keyBytes: Uint8Array;
  if (storedKey) {
    keyBytes = aesjs.utils.hex.toBytes(storedKey);
  } else {
    keyBytes = getRandomBytes(32);
    await SecureStore.setItemAsync(key, toHex(keyBytes));
  }
  const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(1));
  return toHex(cipher.encrypt(aesjs.utils.utf8.toBytes(value)));
}

async function decrypt(key: string, value: string): Promise<string | null> {
  const storedKey = await SecureStore.getItemAsync(key);
  if (!storedKey) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(storedKey), new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
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
