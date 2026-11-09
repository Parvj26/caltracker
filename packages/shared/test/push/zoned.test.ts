import { describe, expect, it } from 'vitest';
import { localMinutes, localWallTimeToUtc } from '../../src/push/zoned';

const d = (s: string) => new Date(s);

describe('localWallTimeToUtc', () => {
  it('maps a wall time', () => expect(localWallTimeToUtc('2026-11-10', '07:00', 'Pacific/Auckland')).toEqual(d('2026-11-09T18:00Z')));
  it('maps UTC', () => expect(localWallTimeToUtc('2026-11-10', '07:00', 'UTC')).toEqual(d('2026-11-10T07:00Z')));
  it('maps a half-hour zone', () => expect(localWallTimeToUtc('2026-11-09', '08:00', 'Asia/Kolkata')).toEqual(d('2026-11-09T02:30Z')));
  it('gap → after the gap', () => expect(localWallTimeToUtc('2027-03-14', '02:30', 'America/New_York')).toEqual(d('2027-03-14T07:00Z')));
  it('overlap → earlier', () => expect(localWallTimeToUtc('2026-11-01', '01:30', 'America/New_York')).toEqual(d('2026-11-01T05:30Z')));
  it('just after a fall-back day', () => expect(localWallTimeToUtc('2026-11-01', '07:00', 'America/New_York')).toEqual(d('2026-11-01T12:00Z')));
});

describe('localMinutes', () => {
  it('reads the local clock', () => {
    expect(localMinutes(d('2026-11-09T10:00Z'), 'Pacific/Auckland')).toBe(23 * 60);
    expect(localMinutes(d('2026-11-09T02:40Z'), 'Asia/Kolkata')).toBe(8 * 60 + 10);
    expect(localMinutes(d('2026-11-09T00:00Z'), 'UTC')).toBe(0);
  });
});
