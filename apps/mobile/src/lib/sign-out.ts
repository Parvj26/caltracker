// The one explicit sign-out. Also forgets the saved exercise library (it can hold the account's custom exercises).
// Only this explicit action does that: a failed offline token refresh must keep the saved library usable.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { forgetIndexUser } from './exercise-index';
import { supabase } from './supabase';

export async function signOutAndForget(): Promise<void> {
  await forgetIndexUser(AsyncStorage);
  await supabase.auth.signOut();
}
