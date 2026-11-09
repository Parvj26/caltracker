import { describe, expect, it } from 'vitest';
import { DEFAULT_PUSH_PREFS } from '../../src/push/prefs';
import { REMINDER_WINDOW_MINUTES, pushExpired, reminderDue } from '../../src/push/reminder';

const d = (s: string) => new Date(s);
const q = { ...DEFAULT_PUSH_PREFS };

describe('reminderDue', () => {
  it('has a 60-minute window', () => expect(REMINDER_WINDOW_MINUTES).toBe(60));
  it('08:05 London is due', () => expect(reminderDue(d('2026-11-09T08:05Z'), q, 'Europe/London', null)).toBe(true));
  it('08:00 is due', () => expect(reminderDue(d('2026-11-09T08:00Z'), q, 'Europe/London', null)).toBe(true));
  it('07:59 is not', () => expect(reminderDue(d('2026-11-09T07:59Z'), q, 'Europe/London', null)).toBe(false));
  it('09:00 is not (window is 60 min)', () => expect(reminderDue(d('2026-11-09T09:00Z'), q, 'Europe/London', null)).toBe(false));
  it('already sent today', () => expect(reminderDue(d('2026-11-09T08:05Z'), q, 'Europe/London', '2026-11-09')).toBe(false));
  it('sent yesterday', () => expect(reminderDue(d('2026-11-09T08:05Z'), q, 'Europe/London', '2026-11-08')).toBe(true));
  it('Kolkata 08:10 IST', () => expect(reminderDue(d('2026-11-09T02:40Z'), q, 'Asia/Kolkata', null)).toBe(true));
  it('uses the local date for "already sent"', () =>
    // 2026-11-09T20:00Z is 09:00 on 2026-11-10 in Auckland; a reminder sent on the 9th (local) does not count.
    expect(reminderDue(d('2026-11-09T19:30Z'), q, 'Pacific/Auckland', '2026-11-09')).toBe(true));
  it('23:30 reminder is not due at 00:10 next day', () =>
    expect(reminderDue(d('2026-11-10T00:10Z'), { ...q, reminderTime: '23:30' }, 'UTC', null)).toBe(false));
  it('23:30 reminder is due at 23:45', () => expect(reminderDue(d('2026-11-09T23:45Z'), { ...q, reminderTime: '23:30' }, 'UTC', null)).toBe(true));
  it('bad zone is UTC', () => expect(reminderDue(d('2026-11-09T08:05Z'), q, 'Mars/Base', null)).toBe(true));
});

describe('pushExpired', () => {
  it('workout_changed deferred to tomorrow expires', () =>
    expect(pushExpired('workout_changed', d('2026-11-09T22:30Z'), d('2026-11-10T07:00Z'), 'Europe/London')).toBe(true));
  it('daily_reminder deferred to tomorrow expires', () =>
    expect(pushExpired('daily_reminder', d('2026-11-09T22:30Z'), d('2026-11-10T07:00Z'), 'Europe/London')).toBe(true));
  it('same local day does not expire', () =>
    expect(pushExpired('workout_changed', d('2026-11-09T05:30Z'), d('2026-11-09T07:00Z'), 'Europe/London')).toBe(false));
  it('uses the local day, not UTC', () =>
    // Both instants are 2026-11-10 in Auckland although the UTC dates differ.
    expect(pushExpired('workout_changed', d('2026-11-09T11:30Z'), d('2026-11-10T01:00Z'), 'Pacific/Auckland')).toBe(false));
  it('message never expires', () =>
    expect(pushExpired('message', d('2026-11-09T22:30Z'), d('2026-11-10T07:00Z'), 'Europe/London')).toBe(false));
});
