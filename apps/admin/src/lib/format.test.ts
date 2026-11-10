import { describe, expect, it } from 'vitest';
import { agoLabel, appVersionsLabel, sinceLabel, trendLabel, whenLabel } from './format';

const now = new Date('2026-11-09T19:10:00Z');

describe('agoLabel', () => {
  it('reads like the mockups', () => {
    expect(agoLabel('2026-11-09T19:09:30Z', now)).toBe('just now');
    expect(agoLabel('2026-11-09T19:09:00Z', now)).toBe('1 min ago');
    expect(agoLabel('2026-11-09T17:10:00Z', now)).toBe('2 h ago');
    expect(agoLabel('2026-11-07T19:10:00Z', now)).toBe('2 days ago');
    expect(agoLabel(null, now)).toBe('never');
  });
});

describe('sinceLabel', () => {
  it('counts whole days', () => {
    expect(sinceLabel('2026-11-09T01:00:00Z', now)).toBe('today');
    expect(sinceLabel('2026-11-08T12:00:00Z', now)).toBe('1 day');
    expect(sinceLabel('2026-11-07T10:00:00Z', now)).toBe('2 days');
    expect(sinceLabel(null, now)).toBe('—');
  });
});

describe('trendLabel', () => {
  it('compares this week with last', () => {
    expect(trendLabel(5, 3)).toBe('▲ 2 vs last');
    expect(trendLabel(2, 6)).toBe('▼ 4 vs last');
    expect(trendLabel(4, 4)).toBe('same as last');
  });
});

describe('whenLabel', () => {
  it('shows the time today, the weekday this week, else the date', () => {
    expect(whenLabel('2026-11-09T19:05:00Z', now, 'UTC')).toBe('7:05 pm');
    expect(whenLabel('2026-11-06T10:00:00Z', now, 'UTC')).toBe('Fri');
    expect(whenLabel('2026-10-20T10:00:00Z', now, 'UTC')).toBe('20 Oct');
  });
});

describe('appVersionsLabel', () => {
  it('lists versions with their phone count', () => {
    expect(appVersionsLabel([{ version: '1.0.0 (2)', devices: 2 }])).toBe('1.0.0 (2) · 2 phones');
    expect(appVersionsLabel([{ version: '1.0.0', devices: 1 }, { version: '0.9.0', devices: 3 }])).toBe('1.0.0 · 1 phone, 0.9.0 · 3 phones');
    expect(appVersionsLabel([])).toBe('none yet');
  });
});
