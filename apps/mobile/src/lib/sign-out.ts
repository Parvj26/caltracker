// The one explicit sign-out. Before ending the session it forgets what this device keeps for the account:
// - the saved exercise library (it can hold the account's custom exercises), and
// - the copy of the sticker book, and
// - the Today tab's copies (first name, community posts, recent PRs), and
// - the copy of the food log (meals still waiting to be sent stay, like unsent messages).
// Only this explicit action does that: a failed offline token refresh must keep the saved library usable.
// The not-yet-shown surprises (pendingReveals) stay, so they still show when the same client signs back in.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { keysToForget } from './device-cache-keys';
import { forgetIndexUser } from './exercise-index';
import { supabase } from './supabase';

export async function signOutAndForget(): Promise<void> {
  await forgetIndexUser(AsyncStorage);
  try {
    const { data } = await supabase.auth.getSession();
    const keys = keysToForget(await AsyncStorage.getAllKeys(), data.session?.user.id ?? null);
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // the copy is a convenience; never block signing out on it
  }
  await supabase.auth.signOut();
}
