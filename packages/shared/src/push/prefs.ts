import { isPushType } from './catalogue';
import type { PushType } from './catalogue';

/** A client's notification settings. Times are local wall times 'HH:MM' in the client's time zone. */
export type PushPrefs = {
  disabled: PushType[];
  reminderTime: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
};

/** A notification_prefs row as Postgres returns it (times as 'HH:MM:SS'). */
export type PushPrefsRow = {
  disabled: string[];
  reminder_time: string;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
};

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  disabled: [],
  reminderTime: '08:00',
  quietEnabled: true,
  quietStart: '22:00',
  quietEnd: '07:00',
};

const hhmm = (t: string) => t.slice(0, 5);

/** No row means all defaults; unknown keys (from a newer app version) are dropped. */
export function prefsFromRow(row: PushPrefsRow | null): PushPrefs {
  if (!row) return { ...DEFAULT_PUSH_PREFS, disabled: [] };
  return {
    disabled: [...new Set(row.disabled.filter(isPushType))],
    reminderTime: hhmm(row.reminder_time),
    quietEnabled: row.quiet_enabled,
    quietStart: hhmm(row.quiet_start),
    quietEnd: hhmm(row.quiet_end),
  };
}

export function prefsToRow(p: PushPrefs): PushPrefsRow {
  return {
    disabled: [...p.disabled],
    reminder_time: p.reminderTime,
    quiet_enabled: p.quietEnabled,
    quiet_start: p.quietStart,
    quiet_end: p.quietEnd,
  };
}

export function isEnabled(prefs: PushPrefs | null, type: PushType): boolean {
  return !prefs || !prefs.disabled.includes(type);
}

export function withType(prefs: PushPrefs, type: PushType, on: boolean): PushPrefs {
  const rest = prefs.disabled.filter((t) => t !== type);
  return { ...prefs, disabled: on ? rest : [...rest, type] };
}
