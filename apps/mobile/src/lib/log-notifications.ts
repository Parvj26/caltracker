// Local notifications and haptics for logging. Push notifications (APNs, from the server) are in push.ts.
//   * Reminder: "Still training?" REMINDER_DELAY_MS after the last ticked set, re-scheduled on every tick, unless the
//     client switched it off (setStillTrainingEnabled).
// Fixed identifiers, so scheduling again replaces the earlier one and cancelling needs no stored id.
// Every call swallows errors: a notification is never worth breaking the workout over.
import { REMINDER_DELAY_MS } from '@caltracker/shared';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

/** The rest alarm of earlier versions (there is no rest timer any more): cancelled at start-up, never scheduled. */
const OLD_REST_ID = 'caltracker.rest-end';
const REMINDER_ID = 'caltracker.reminder';

export type NotificationData = { kind: 'reminder'; logId: string };

const warn = (what: string) => (e: unknown) =>
  console.warn(`[log-notifications] ${what}: ${e instanceof Error ? e.message : String(e)}`);

let handlerSet = false;

/** Decides how a notification shows while the app is open. Call once at start-up. */
export function initNotifications(): void {
  if (handlerSet) return;
  handlerSet = true;
  cancel(OLD_REST_ID);
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** Asks for permission (alerts, sounds and the app-icon badge, used by push too) the first time only. True when allowed. */
export async function ensurePermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: true },
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

/** The client's "Still training?" switch (Settings -> Notifications). Off cancels it and stops scheduling it. */
let stillTrainingOn = true;

export function setStillTrainingEnabled(on: boolean): void {
  stillTrainingOn = on;
  if (!on) cancelReminder();
}

export function scheduleReminder(name: string, logId: string): void {
  if (!stillTrainingOn) return;
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

function reminderLogId(r: Notifications.NotificationResponse): string | null {
  const data = r.notification.request.content.data as Partial<NotificationData> | undefined;
  return data?.kind === 'reminder' && typeof data.logId === 'string' ? data.logId : null;
}

/**
 * The log a tapped reminder belongs to, so the app can open it. Returns an unsubscribe function.
 * Also covers the tap that launched the app from closed, which the listener misses: that response is read once
 * on start-up and then cleared, so it never opens the log again on a later mount.
 */
export function onReminderTapped(open: (logId: string) => void): () => void {
  let active = true;
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const id = reminderLogId(r);
    if (!id) return;
    Notifications.clearLastNotificationResponseAsync().catch(warn('clear last response'));
    open(id);
  });
  Notifications.getLastNotificationResponseAsync()
    .then(async (r) => {
      const id = r ? reminderLogId(r) : null;
      if (!id) return;
      await Notifications.clearLastNotificationResponseAsync();
      if (active) open(id);
    })
    .catch(warn('last response'));
  return () => {
    active = false;
    sub.remove();
  };
}
