// Local notifications and haptics for logging. Local only: no push tokens, no server.
//   * Rest end: fires when the rest countdown reaches zero. In the app it only plays the sound (the screen
//     vibrates itself); in the background it shows as a normal notification.
//   * Reminder: "Still training?" REMINDER_DELAY_MS after the last ticked set, re-scheduled on every tick.
// Fixed identifiers, so scheduling again replaces the earlier one and cancelling needs no stored id.
// Every call swallows errors: a notification is never worth breaking the workout over.
import { REMINDER_DELAY_MS } from '@caltracker/shared';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Vibration } from 'react-native';

const REST_ID = 'caltracker.rest-end';
const REMINDER_ID = 'caltracker.reminder';

export type NotificationData = { kind: 'rest' } | { kind: 'reminder'; logId: string };

const warn = (what: string) => (e: unknown) =>
  console.warn(`[log-notifications] ${what}: ${e instanceof Error ? e.message : String(e)}`);

let handlerSet = false;

/** Decides how a notification shows while the app is open. Call once at start-up. */
export function initNotifications(): void {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: (n) => {
      const rest = (n.request.content.data as Partial<NotificationData> | undefined)?.kind === 'rest';
      return Promise.resolve({
        // The rest sheet is already on screen, so only the sound plays.
        shouldShowBanner: !rest,
        shouldShowList: !rest,
        shouldPlaySound: true,
        shouldSetBadge: false,
      });
    },
  });
}

/** Asks for permission the first time only (the system never asks twice). True when allowed. */
export async function ensurePermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return asked.granted;
  } catch (e) {
    warn('permission')(e);
    return false;
  }
}

function schedule(identifier: string, seconds: number, content: Notifications.NotificationContentInput): void {
  Notifications.scheduleNotificationAsync({
    identifier,
    content,
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(seconds)) },
  }).catch(warn(`schedule ${identifier}`));
}

function cancel(identifier: string): void {
  Notifications.cancelScheduledNotificationAsync(identifier).catch(warn(`cancel ${identifier}`));
}

export function scheduleRestEnd(seconds: number): void {
  const data: NotificationData = { kind: 'rest' };
  schedule(REST_ID, seconds, { title: 'Rest is over', body: 'Time for your next set.', sound: true, data });
}

export function cancelRestEnd(): void {
  cancel(REST_ID);
}

export function scheduleReminder(name: string, logId: string): void {
  const data: NotificationData = { kind: 'reminder', logId };
  schedule(REMINDER_ID, REMINDER_DELAY_MS / 1000, {
    body: `Still training? 💪 Tap to finish your ${name} workout.`,
    sound: true,
    data,
  });
}

export function cancelReminder(): void {
  cancel(REMINDER_ID);
}

/** Light tap when a set is ticked. */
export function tapHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(warn('haptic'));
}

/** Rest over, with the app open: a buzz the client feels in a pocket or on a bench. */
export function restOverHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(warn('haptic'));
  Vibration.vibrate();
}

/** The log a tapped reminder belongs to, so the app can open it. Returns an unsubscribe function. */
export function onReminderTapped(open: (logId: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const data = r.notification.request.content.data as Partial<NotificationData> | undefined;
    if (data?.kind === 'reminder' && typeof data.logId === 'string') open(data.logId);
  });
  return () => sub.remove();
}
