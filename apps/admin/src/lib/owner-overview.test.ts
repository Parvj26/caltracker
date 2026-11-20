import { describe, expect, it } from 'vitest';
import { productHealthItems, showTestAccounts, testToggleHref, weekTrend, type OwnerOverview } from './owner-overview';

const now = new Date('2026-11-20T12:00:00Z');
const ago = (iso: string) => `${Math.round((now.getTime() - Date.parse(iso)) / 3_600_000)} h ago`;
const healthy: OwnerOverview['health'] = {
  last_push_run_at: '2026-11-20T11:59:00Z',
  last_push_status: 'succeeded',
  push_failed_24h: 0,
  old_builds: { min_build: 6, people: 0, builds: [] },
};

describe('productHealthItems', () => {
  it('is empty when nothing is wrong (the page says all good)', () => {
    expect(productHealthItems(healthy, now, ago)).toEqual([]);
  });

  it('flags the sender not running for over 2 h or never; a recent failed run says so instead', () => {
    expect(productHealthItems({ ...healthy, last_push_run_at: '2026-11-20T09:00:00Z' }, now, ago)).toEqual([
      { tag: 'Not sending', main: 'Notifications not sent in 2 h', sub: 'Last run 3 h ago' },
    ]);
    expect(productHealthItems({ ...healthy, last_push_run_at: '2026-11-20T10:30:00Z' }, now, ago)).toEqual([]);
    expect(productHealthItems({ ...healthy, last_push_run_at: null, last_push_status: null }, now, ago)[0]?.sub).toBe('The sender has not run');
    expect(productHealthItems({ ...healthy, last_push_status: 'failed' }, now, ago)).toEqual([
      { tag: 'Not sending', main: 'Last notification run failed', sub: 'Ran 0 h ago' },
    ]);
    expect(
      productHealthItems({ ...healthy, last_push_run_at: '2026-11-20T09:00:00Z', last_push_status: 'failed' }, now, ago)[0]?.main,
    ).toBe('Notifications not sent in 2 h');
  });

  it('counts failed notifications', () => {
    expect(productHealthItems({ ...healthy, push_failed_24h: 1 }, now, ago)).toEqual([
      { tag: 'Failed', main: '1 notification failed', sub: 'Last 24 h' },
    ]);
    expect(productHealthItems({ ...healthy, push_failed_24h: 3 }, now, ago)[0]?.main).toBe('3 notifications failed');
  });

  it('shows old builds only when there is a minimum and someone is below it', () => {
    expect(productHealthItems({ ...healthy, old_builds: { min_build: 6, people: 1, builds: [5] } }, now, ago)).toEqual([
      { tag: 'Old build', main: '1 person on build 5', sub: 'Minimum is 6' },
    ]);
    expect(productHealthItems({ ...healthy, old_builds: { min_build: 6, people: 2, builds: [5, 4] } }, now, ago)[0]?.main).toBe(
      '2 people on builds 4, 5',
    );
    expect(productHealthItems({ ...healthy, old_builds: { min_build: 0, people: 1, builds: [5] } }, now, ago)).toEqual([]);
  });
});

describe('weekTrend', () => {
  it('matches the boards', () => {
    expect(weekTrend({ this_week: 0, last_week: 0 })).toBe('same as last week');
    expect(weekTrend({ this_week: 1, last_week: 2 })).toBe('▼ 1 vs last week');
    expect(weekTrend({ this_week: 1, last_week: 0 }, true)).toBe('▲ 1 vs last');
    expect(weekTrend({ this_week: 0, last_week: 0 }, true)).toBe('same as last');
  });
});

describe('test accounts toggle', () => {
  it('is on only for ?test=1', () => {
    expect(showTestAccounts('1')).toBe(true);
    expect(showTestAccounts(undefined)).toBe(false);
    expect(showTestAccounts('0')).toBe(false);
  });
  it('flips the param and keeps the others', () => {
    expect(testToggleHref('/overview', {}, false)).toBe('/overview?test=1');
    expect(testToggleHref('/overview', { test: '1' }, true)).toBe('/overview');
    expect(testToggleHref('/coaches', { test: '1', x: 'y' }, true)).toBe('/coaches?x=y');
  });
});
