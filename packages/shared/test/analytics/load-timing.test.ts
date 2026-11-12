import { describe, expect, it } from 'vitest';
import { firstLoadBreakdown, slowFirstLoad, type NavTiming } from '../../src/analytics/load-timing';
import { sanitize } from '../../src/analytics/sanitize';

// A slow first load: 100 ms redirect, 50 ms DNS + connect, 2 s waiting for the server, 300 ms download, 1 s on the device.
const nav: NavTiming = {
  type: 'navigate',
  redirectStart: 0,
  redirectEnd: 100,
  domainLookupStart: 100,
  connectEnd: 150,
  requestStart: 160,
  responseStart: 2160,
  responseEnd: 2460,
  domContentLoadedEventEnd: 3460.4,
};

describe('firstLoadBreakdown', () => {
  it('splits the load into redirect, network setup, server, download and device time', () => {
    expect(firstLoadBreakdown(nav)).toEqual({
      ms: 3460,
      redirect_ms: 100,
      dns_tcp_ms: 50,
      server_ms: 2000,
      download_ms: 300,
      dom_ms: 1000,
      nav_type: 'navigate',
    });
  });
  it('never reports negative or fractional parts (a missing timestamp is 0 in the browser)', () => {
    const out = firstLoadBreakdown({ ...nav, redirectStart: 0, redirectEnd: 0, domainLookupStart: 0, connectEnd: 0, requestStart: 0.6, responseStart: 0 });
    expect(out.redirect_ms).toBe(0);
    expect(out.dns_tcp_ms).toBe(0);
    expect(out.server_ms).toBe(0);
    for (const v of Object.values(out)) if (typeof v === 'number') expect(Number.isInteger(v) && v >= 0).toBe(true);
  });
  it('keeps only the known navigation types', () => {
    expect(firstLoadBreakdown({ ...nav, type: 'reload' }).nav_type).toBe('reload');
    expect(firstLoadBreakdown({ ...nav, type: 'back_forward' }).nav_type).toBe('back_forward');
    expect(firstLoadBreakdown({ ...nav, type: 'something/else?x=1' }).nav_type).toBe('other');
  });
});

describe('slowFirstLoad', () => {
  it('returns the breakdown only when the page took over 2 s to be ready', () => {
    expect(slowFirstLoad(nav)?.ms).toBe(3460);
    expect(slowFirstLoad({ ...nav, domContentLoadedEventEnd: 2000 })).toBeNull();
    expect(slowFirstLoad(undefined)).toBeNull();
  });
});

describe('sanitize keeps the breakdown', () => {
  it('lets the timing numbers and nav_type through on slow_screen', () => {
    const props = { screen: '/workouts', ...firstLoadBreakdown(nav) };
    expect(sanitize('slow_screen', props)).toEqual(props);
  });
  it('turns an unknown nav_type into other', () => {
    expect(sanitize('slow_screen', { nav_type: 'https://caltracker.app/clients/abc' })).toEqual({ nav_type: 'other' });
  });
});
