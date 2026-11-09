// Push notifications on this iPhone: permission, the APNs device token the server sends to, taps and the badge.
// The server (supabase/functions/send-push) sends straight to APNs, so this registers the raw device token
// (getDevicePushTokenAsync), not an Expo push token. Every call swallows errors: a notification is never worth
// breaking the app over. Rules (badge, where a tap opens) live in push-logic.ts.
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { pushDataOf } from './push-logic';
import { supabase } from './supabase';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

const warn = (what: string) => (e: unknown) =>
  console.warn(`[push] ${what}: ${e instanceof Error ? e.message : String(e)}`);

/** The token registered in this app session, so Sign out can remove it without asking iOS again. */
let currentToken: string | null = null;

function toPermission(p: Notifications.NotificationPermissionsStatus): PushPermission {
  if (p.granted) return 'granted';
  return p.status === Notifications.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}

export async function osPermission(): Promise<PushPermission> {
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch (e) {
    warn('permission')(e);
    return 'denied';
  }
}

/** Asks iOS (alerts, sounds and the app-icon badge). iOS shows its alert once; later calls just answer. */
export async function requestPushPermission(): Promise<boolean> {
  try {
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: true },
    });
    return asked.granted;
  } catch (e) {
    warn('request permission')(e);
    return false;
  }
}

async function register(token: string): Promise<void> {
  const clean = token.toLowerCase();
  const { error } = await supabase.rpc('register_push_device', {
    p_token: clean,
    p_app_version: (Application.nativeApplicationVersion ?? '').slice(0, 32),
  });
  if (error) throw new Error(error.message);
  currentToken = clean;
}

/** Registers this iPhone for the signed-in user (moving the token from any earlier account). Only when allowed. */
export async function registerDevice(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    if ((await osPermission()) !== 'granted') return;
    // On iOS the device token is a hex string (typed any by expo-notifications).
    const data: unknown = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof data === 'string' && data) await register(data);
  } catch (e) {
    warn('register')(e);
  }
}

/** iOS can hand out a new token at any time: register it. Returns an unsubscribe function. */
export function onTokenChanged(): () => void {
  const sub = Notifications.addPushTokenListener((t) => {
    if (typeof t.data === 'string' && t.data) register(t.data).catch(warn('register new token'));
  });
  return () => sub.remove();
}

/** Removes this iPhone from the signed-in user's devices, giving up after timeoutMs. Never throws. */
export async function unregisterDevice(timeoutMs = 3000): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const work = (async () => {
    const token: unknown = currentToken ?? (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== 'string' || !token) return;
    const { error } = await supabase.rpc('unregister_push_device', { p_token: token.toLowerCase() });
    if (error) throw new Error(error.message);
    currentToken = null;
  })().catch(warn('unregister'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
}

function dataOf(r: Notifications.NotificationResponse): Record<string, unknown> | null {
  const { content, trigger } = r.notification.request;
  const payload = trigger && 'type' in trigger && trigger.type === 'push' ? trigger.payload : undefined;
  return pushDataOf(content.data, payload);
}

/**
 * Calls open with the data of a tapped push notification (not the local still-training reminder: that one is
 * log-notifications'). Also covers the tap that launched the app from closed, read once and then cleared.
 * Returns an unsubscribe function.
 */
export function onPushTapped(open: (data: Record<string, unknown>) => void): () => void {
  let active = true;
  const ours = (d: Record<string, unknown> | null): d is Record<string, unknown> =>
    d !== null && d.kind !== 'reminder' && typeof d.route === 'string';
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const d = dataOf(r);
    if (!ours(d)) return;
    Notifications.clearLastNotificationResponseAsync().catch(warn('clear last response'));
    open(d);
  });
  Notifications.getLastNotificationResponseAsync()
    .then(async (r) => {
      const d = r ? dataOf(r) : null;
      if (!ours(d)) return;
      await Notifications.clearLastNotificationResponseAsync();
      if (active) open(d);
    })
    .catch(warn('last response'));
  return () => {
    active = false;
    sub.remove();
  };
}

let lastBadge: number | null = null;

/** Sets the app-icon badge (skipped when unchanged). */
export function setBadge(n: number): void {
  if (n === lastBadge) return;
  lastBadge = n;
  Notifications.setBadgeCountAsync(n).catch(warn('badge'));
}
