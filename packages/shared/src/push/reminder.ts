import { safeTimeZone } from '../awards/history';
import { localDateOf } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import type { ServerPushType } from './catalogue';
import type { PushPrefs } from './prefs';
import { localMinutes, wallTimeMinutes } from './zoned';

/** How long after the reminder time a reminder may still go out (the cron job runs every 15 minutes). */
export const REMINDER_WINDOW_MINUTES = 60;

/**
 * Whether the daily reminder is due: local time within REMINDER_WINDOW_MINUTES after the reminder time (never past
 * local midnight) and none sent yet on this local day. An unknown zone counts as UTC.
 */
export function reminderDue(nowUtc: Date, prefs: PushPrefs, timeZone: string, lastReminderDate: IsoDate | null): boolean {
  const zone = safeTimeZone(timeZone);
  const m = localMinutes(nowUtc, zone);
  const start = wallTimeMinutes(prefs.reminderTime);
  const end = Math.min(start + REMINDER_WINDOW_MINUTES, 24 * 60);
  return m >= start && m < end && lastReminderDate !== localDateOf(nowUtc, zone);
}

const DAY_BOUND: readonly ServerPushType[] = ['workout_changed', 'daily_reminder'];

/** Day-bound pushes ("Today's workout changed", the daily reminder) are dropped once they would land on a later day. */
export function pushExpired(type: ServerPushType, createdAt: Date, sendAt: Date, timeZone: string): boolean {
  if (!DAY_BOUND.includes(type)) return false;
  const zone = safeTimeZone(timeZone);
  return localDateOf(sendAt, zone) > localDateOf(createdAt, zone);
}
