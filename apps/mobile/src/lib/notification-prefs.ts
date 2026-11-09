// The client's notification settings (notification_prefs; no row = all defaults), with a copy on the phone so they
// still apply offline (the still-training reminder is scheduled on the phone). Rules are in packages/shared/src/push.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PUSH_PREFS, prefsFromRow, prefsToRow, type PushPrefs, type PushPrefsRow } from '@caltracker/shared';
import { notificationPrefsKey } from './device-cache-keys';
import { supabase } from './supabase';

async function cached(userId: string): Promise<PushPrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(notificationPrefsKey(userId));
    return raw ? prefsFromRow(JSON.parse(raw) as PushPrefsRow) : null;
  } catch {
    return null;
  }
}

async function remember(userId: string, prefs: PushPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(notificationPrefsKey(userId), JSON.stringify(prefsToRow(prefs)));
  } catch {
    // the copy is a convenience
  }
}

/** The server's settings (and remembers them); without signal the copy, else the defaults. */
export async function loadPrefs(userId: string): Promise<{ prefs: PushPrefs; offline: boolean }> {
  try {
    const { data, error } = await supabase
      .from('notification_prefs')
      .select('disabled, reminder_time, quiet_enabled, quiet_start, quiet_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const prefs = prefsFromRow(data);
    await remember(userId, prefs);
    return { prefs, offline: false };
  } catch {
    return { prefs: (await cached(userId)) ?? { ...DEFAULT_PUSH_PREFS, disabled: [] }, offline: true };
  }
}

/** Saves the settings for this user, then the copy. Throws a readable error. */
export async function savePrefs(userId: string, prefs: PushPrefs): Promise<void> {
  const { error } = await supabase
    .from('notification_prefs')
    // user_id is not sent: the column defaults to the caller (and clients may not write it).
    .upsert(prefsToRow(prefs), { onConflict: 'user_id' });
  if (error) throw new Error('Couldn’t save your notification settings. Check your connection and try again.');
  await remember(userId, prefs);
}
