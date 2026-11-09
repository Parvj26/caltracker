import { describe, expect, it } from 'vitest';
import { DEFAULT_PUSH_PREFS } from '../../src/push/prefs';
import { nextAllowedTime } from '../../src/push/quiet-hours';

const d = (s: string) => new Date(s);
const q = { ...DEFAULT_PUSH_PREFS };

describe('nextAllowedTime', () => {
  it('23:30 London waits to 07:00', () => expect(nextAllowedTime(d('2026-11-09T23:30Z'), q, 'Europe/London')).toEqual(d('2026-11-10T07:00Z')));
  it('06:59 waits one minute', () => expect(nextAllowedTime(d('2026-11-10T06:59Z'), q, 'Europe/London')).toEqual(d('2026-11-10T07:00Z')));
  it('07:00 sends now', () => expect(nextAllowedTime(d('2026-11-10T07:00Z'), q, 'Europe/London')).toEqual(d('2026-11-10T07:00Z')));
  it('21:59 sends now', () => expect(nextAllowedTime(d('2026-11-09T21:59Z'), q, 'Europe/London')).toEqual(d('2026-11-09T21:59Z')));
  it('22:00 waits', () => expect(nextAllowedTime(d('2026-11-09T22:00Z'), q, 'Europe/London')).toEqual(d('2026-11-10T07:00Z')));
  it('quiet off sends now', () =>
    expect(nextAllowedTime(d('2026-11-09T23:30Z'), { ...q, quietEnabled: false }, 'Europe/London')).toEqual(d('2026-11-09T23:30Z')));
  it('equal start and end means no window', () =>
    expect(nextAllowedTime(d('2026-11-09T23:30Z'), { ...q, quietStart: '22:00', quietEnd: '22:00' }, 'Europe/London')).toEqual(
      d('2026-11-09T23:30Z'),
    ));
  it('daytime window 13:00–15:00', () =>
    expect(nextAllowedTime(d('2026-11-09T14:00Z'), { ...q, quietStart: '13:00', quietEnd: '15:00' }, 'UTC')).toEqual(d('2026-11-09T15:00Z')));
  it('outside a daytime window sends now', () =>
    expect(nextAllowedTime(d('2026-11-09T23:00Z'), { ...q, quietStart: '13:00', quietEnd: '15:00' }, 'UTC')).toEqual(d('2026-11-09T23:00Z')));
  it('Auckland 23:00 NZDT waits to 07:00 NZDT', () =>
    expect(nextAllowedTime(d('2026-11-09T10:00Z'), q, 'Pacific/Auckland')).toEqual(d('2026-11-09T18:00Z')));
  it('fall back New York', () => expect(nextAllowedTime(d('2026-11-01T04:30Z'), q, 'America/New_York')).toEqual(d('2026-11-01T12:00Z')));
  it('spring forward: end inside the gap', () =>
    expect(nextAllowedTime(d('2027-03-14T06:30Z'), { ...q, quietStart: '01:00', quietEnd: '02:30' }, 'America/New_York')).toEqual(
      d('2027-03-14T07:00Z'),
    ));
  it('bad zone is UTC', () => expect(nextAllowedTime(d('2026-11-09T23:30Z'), q, 'Mars/Base')).toEqual(d('2026-11-10T07:00Z')));
});
