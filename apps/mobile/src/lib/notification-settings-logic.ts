// What the Notifications settings screen shows (pure, unit tested). Labels and order follow the approved
// Notifications board; the switches come from the shared catalogue (types not built yet, available: false, are left out).
import {
  DEFAULT_PUSH_PREFS,
  PUSH_GROUP_TITLES,
  PUSH_TYPES,
  isEnabled,
  notificationCatalogue,
  type PushGroup,
  type PushPrefs,
  type PushType,
} from '@caltracker/shared';
import type { PushPermission } from './push';

export type TimeField = 'reminderTime' | 'quietStart' | 'quietEnd';

export type SettingsRow =
  | { kind: 'switch'; type: PushType; label: string; hint: string; on: boolean }
  | { kind: 'quiet'; label: string; hint: string; on: boolean }
  | { kind: 'time'; field: TimeField; label: string; hint: string; value: string };

export type SettingsSection = { title: string; rows: SettingsRow[] };

function parts(time: string): { h12: number; m: number; ampm: 'AM' | 'PM' } {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return { h12: h % 12 === 0 ? 12 : h % 12, m, ampm: h < 12 ? 'AM' : 'PM' };
}

/** '22:00' -> '10:00 PM'. */
export function clockLabel(time: string): string {
  const { h12, m, ampm } = parts(time);
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** '22:00' -> '10 PM', '07:30' -> '7:30 AM'. */
export function shortClock(time: string): string {
  const { h12, m, ampm } = parts(time);
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** The Settings sheet's "Notifications" row line. Before the settings load, the defaults. */
export function settingsSummary(prefs: PushPrefs | null, permission: PushPermission | null): string {
  if (permission !== 'granted') return 'Off on this iPhone';
  const p = prefs ?? DEFAULT_PUSH_PREFS;
  return p.quietEnabled ? `On · Quiet ${shortClock(p.quietStart)} – ${shortClock(p.quietEnd)}` : 'On';
}

/** Every time of day in steps of stepMinutes: '00:00' … '23:30'. */
export function timeOptions(stepMinutes = 30): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

const GROUPS: PushGroup[] = ['workouts', 'coach', 'community'];

export function settingsSections(prefs: PushPrefs): SettingsSection[] {
  const sections: SettingsSection[] = GROUPS.map((group) => ({
    title: PUSH_GROUP_TITLES[group],
    rows: PUSH_TYPES.filter((t) => notificationCatalogue[t].group === group && notificationCatalogue[t].available).flatMap(
      (type): SettingsRow[] => {
        const { label, hint } = notificationCatalogue[type];
        const on = isEnabled(prefs, type);
        const row: SettingsRow = { kind: 'switch', type, label, hint, on };
        if (type !== 'daily_reminder' || !on) return [row];
        return [
          row,
          { kind: 'time', field: 'reminderTime', label: 'Reminder time', hint: 'When the daily reminder arrives', value: prefs.reminderTime },
        ];
      },
    ),
  }));
  const quiet: SettingsRow[] = [{ kind: 'quiet', label: 'Quiet hours', hint: 'No pings overnight', on: prefs.quietEnabled }];
  if (prefs.quietEnabled) {
    quiet.push(
      { kind: 'time', field: 'quietStart', label: 'From', hint: '', value: prefs.quietStart },
      { kind: 'time', field: 'quietEnd', label: 'To', hint: '', value: prefs.quietEnd },
    );
  }
  return [...sections, { title: 'Quiet hours', rows: quiet }];
}

/** Where the shown settings came from: not yet known, the server, or this phone's copy (no signal). */
export type PrefsSource = 'loading' | 'server' | 'offline';

/** Settings can be changed only once the server's copy is in, so an offline copy never overwrites newer ones. */
export function prefsEditable(source: PrefsSource): boolean {
  return source === 'server';
}

export function prefsNote(source: PrefsSource): string | null {
  if (source === 'loading') return 'Loading your settings…';
  if (source === 'offline') return 'You’re offline. You can change these when you’re back online.';
  return null;
}
