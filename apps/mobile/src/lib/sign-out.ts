// Signing out on purpose: forget the copy of the sticker book kept for this account, then end the session.
// The not-yet-shown surprises (pendingReveals) stay, so they still show when the same client signs back in.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { albumCachePrefix } from './album-logic';
import { supabase } from './supabase';

export async function signOutAndForget(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (id) {
      // One copy per coach the client has had (and the older single copy, saved under the prefix itself).
      const prefix = albumCachePrefix(id);
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k === prefix || k.startsWith(`${prefix}.`));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    }
  } catch {
    // the copy is a convenience; never block signing out on it
  }
  await supabase.auth.signOut();
}
