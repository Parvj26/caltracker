import { describe, expect, it } from 'vitest';
import { DEFAULT_PUSH_PREFS, withType } from '@caltracker/shared';
import { clockLabel, prefsEditable, prefsNote, settingsSections, settingsSummary, shortClock, timeOptions } from './notification-settings-logic';

describe('settingsSummary', () => {
  it('summary', () => {
    expect(settingsSummary(DEFAULT_PUSH_PREFS, 'granted')).toBe('On · Quiet 10 PM – 7 AM');
    expect(settingsSummary({ ...DEFAULT_PUSH_PREFS, quietEnabled: false }, 'granted')).toBe('On');
    expect(settingsSummary(DEFAULT_PUSH_PREFS, 'denied')).toBe('Off on this iPhone');
    expect(settingsSummary(DEFAULT_PUSH_PREFS, 'undetermined')).toBe('Off on this iPhone');
  });
  it('before the settings load', () => expect(settingsSummary(null, 'granted')).toBe('On · Quiet 10 PM – 7 AM'));
  it('uses half hours', () => expect(settingsSummary({ ...DEFAULT_PUSH_PREFS, quietStart: '23:00', quietEnd: '06:30' }, 'granted')).toBe('On · Quiet 11 PM – 6:30 AM'));
});

describe('clock labels', () => {
  it('clock labels', () => {
    expect(clockLabel('08:00')).toBe('8:00 AM');
    expect(clockLabel('00:30')).toBe('12:30 AM');
    expect(clockLabel('12:00')).toBe('12:00 PM');
    expect(clockLabel('22:00')).toBe('10:00 PM');
    expect(shortClock('22:00')).toBe('10 PM');
    expect(shortClock('07:30')).toBe('7:30 AM');
  });
});

describe('timeOptions', () => {
  it('48 half-hour options', () => {
    const t = timeOptions();
    expect(t).toHaveLength(48);
    expect(t[0]).toBe('00:00');
    expect(t[1]).toBe('00:30');
    expect(t[47]).toBe('23:30');
  });
});

describe('settingsSections', () => {
  it('sections follow the mockup and hide meal comments', () => {
    const s = settingsSections(DEFAULT_PUSH_PREFS);
    expect(s.map((x) => x.title)).toEqual(['Workouts', 'Your coach', 'Community', 'Quiet hours']);
    expect(s[0].rows.map((r) => r.label)).toEqual([
      'New workout assigned',
      'Today’s workout changed',
      'Daily reminder',
      'Reminder time',
      'Coach logged your session',
      'Still training?',
    ]);
    expect(s[1].rows.map((r) => r.label)).toEqual(['Messages', 'Comments on your workouts', 'Food targets changed']);
    expect(s[2].rows.map((r) => r.label)).toEqual(['New coach posts', 'Reactions and comments']);
    expect(s[0].rows[3]).toMatchObject({ kind: 'time', field: 'reminderTime', label: 'Reminder time', hint: 'When the daily reminder arrives', value: '08:00' });
    expect(s[3].rows).toEqual([
      { kind: 'quiet', label: 'Quiet hours', hint: 'No pings overnight', on: true },
      { kind: 'time', field: 'quietStart', label: 'From', hint: '', value: '22:00' },
      { kind: 'time', field: 'quietEnd', label: 'To', hint: '', value: '07:00' },
    ]);
  });
  it('switches show what is on', () => {
    const s = settingsSections(withType(DEFAULT_PUSH_PREFS, 'message', false));
    expect(s[1].rows[0]).toMatchObject({ kind: 'switch', type: 'message', on: false });
  });
  it('hides reminder time when the reminder is off', () => {
    const s = settingsSections(withType(DEFAULT_PUSH_PREFS, 'daily_reminder', false));
    expect(s[0].rows.map((r) => r.label)).not.toContain('Reminder time');
  });
  it('hides From/To when quiet hours are off', () => {
    const s = settingsSections({ ...DEFAULT_PUSH_PREFS, quietEnabled: false });
    expect(s[3].rows.map((r) => r.label)).toEqual(['Quiet hours']);
  });
});

describe('editing needs the server’s settings', () => {
  it('only once loaded from the server', () => {
    expect(prefsEditable('server')).toBe(true);
    expect(prefsEditable('loading')).toBe(false);
    expect(prefsEditable('offline')).toBe(false);
  });
  it('says why the switches are off', () => {
    expect(prefsNote('server')).toBeNull();
    expect(prefsNote('loading')).toBe('Loading your settings…');
    expect(prefsNote('offline')).toBe('You’re offline. You can change these when you’re back online.');
  });
});
