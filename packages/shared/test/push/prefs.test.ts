import { describe, expect, it } from 'vitest';
import { DEFAULT_PUSH_PREFS, isEnabled, prefsFromRow, prefsToRow, withType } from '../../src/push/prefs';

describe('push preferences', () => {
  it('no row means defaults', () => expect(prefsFromRow(null)).toEqual(DEFAULT_PUSH_PREFS));

  it('defaults: all on, 08:00 reminder, quiet 22:00–07:00', () =>
    expect(DEFAULT_PUSH_PREFS).toEqual({
      disabled: [],
      reminderTime: '08:00',
      quietEnabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
    }));

  it('trims seconds and drops unknown keys', () =>
    expect(
      prefsFromRow({
        disabled: ['message', 'bogus'],
        reminder_time: '07:30:00',
        quiet_enabled: false,
        quiet_start: '23:00:00',
        quiet_end: '06:00:00',
      }),
    ).toEqual({ disabled: ['message'], reminderTime: '07:30', quietEnabled: false, quietStart: '23:00', quietEnd: '06:00' }));

  it('round-trips through a row', () => {
    const p = { ...DEFAULT_PUSH_PREFS, disabled: ['message' as const], reminderTime: '06:30' };
    expect(prefsToRow(p)).toEqual({
      disabled: ['message'],
      reminder_time: '06:30',
      quiet_enabled: true,
      quiet_start: '22:00',
      quiet_end: '07:00',
    });
    expect(prefsFromRow(prefsToRow(p))).toEqual(p);
  });

  it('isEnabled', () => {
    expect(isEnabled(null, 'message')).toBe(true);
    expect(isEnabled(DEFAULT_PUSH_PREFS, 'message')).toBe(true);
    expect(isEnabled({ ...DEFAULT_PUSH_PREFS, disabled: ['message'] }, 'message')).toBe(false);
    expect(isEnabled({ ...DEFAULT_PUSH_PREFS, disabled: ['message'] }, 'food_targets')).toBe(true);
  });

  it('withType toggles without duplicates', () => {
    expect(withType(withType(DEFAULT_PUSH_PREFS, 'message', false), 'message', false).disabled).toEqual(['message']);
    expect(withType({ ...DEFAULT_PUSH_PREFS, disabled: ['message', 'food_targets'] }, 'message', true).disabled).toEqual([
      'food_targets',
    ]);
  });

  it('withType does not mutate its input', () => {
    const p = { ...DEFAULT_PUSH_PREFS, disabled: [] };
    withType(p, 'message', false);
    expect(p.disabled).toEqual([]);
  });
});
