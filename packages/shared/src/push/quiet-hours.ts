import { safeTimeZone } from '../awards/history';
import { addDays, localDateOf } from '../dates/dates';
import type { PushPrefs } from './prefs';
import { localMinutes, localWallTimeToUtc, wallTimeMinutes } from './zoned';

/**
 * When a push may go out: now, unless now is inside the client's quiet hours [start, end) (the window may cross
 * midnight), then the next end of the window in their time zone. An unknown zone counts as UTC.
 */
export function nextAllowedTime(nowUtc: Date, prefs: PushPrefs, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const start = wallTimeMinutes(prefs.quietStart);
  const end = wallTimeMinutes(prefs.quietEnd);
  if (!prefs.quietEnabled || start === end) return nowUtc;
  const m = localMinutes(nowUtc, zone);
  const crossesMidnight = start > end;
  const inside = crossesMidnight ? m >= start || m < end : m >= start && m < end;
  if (!inside) return nowUtc;
  const today = localDateOf(nowUtc, zone);
  const endDay = crossesMidnight && m >= start ? addDays(today, 1) : today;
  const at = localWallTimeToUtc(endDay, prefs.quietEnd, zone);
  return at.getTime() > nowUtc.getTime() ? at : nowUtc;
}
