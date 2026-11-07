// The one explicit sign-out. Before ending the session it forgets what this device keeps for the account:
// - the saved exercise library (it can hold the account's custom exercises), and
// - the copy of the sticker book, and
// - the copy of the food log (meals still waiting to be sent stay, like unsent messages).
// Only this explicit action does that: a failed offline token refresh must keep the saved library usable.
// The not-yet-shown surprises (pendingReveals) stay, so they still show when the same client signs back in.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { albumCachePrefix } from './album-logic';
import { forgetIndexUser } from './exercise-index';
import { supabase } from './supabase';

export async function signOutAndForget(): Promise<void> {
  await forgetIndexUser(AsyncStorage);
  try {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (id) {
      // One copy per coach the client has had (and the older single copy, saved under the prefix itself).
      const prefix = albumCachePrefix(id);
      const food = `caltracker.food.${id}.`;
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k === prefix || k.startsWith(`${prefix}.`) || k.startsWith(food));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    }
  } catch {
    // the copy is a convenience; never block signing out on it
  }
  await supabase.auth.signOut();
}
