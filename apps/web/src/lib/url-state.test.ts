import { describe, expect, it } from 'vitest';
import { pickParam, withParam } from './url-state';

describe('pickParam', () => {
  const allowed = ['active', 'missed', 'invited'] as const;
  it('reads an allowed value from the address', () => {
    expect(pickParam('missed', allowed, 'active')).toBe('missed');
  });
  it('falls back when the value is missing or not one of the choices (an old or hand-edited link)', () => {
    expect(pickParam(null, allowed, 'active')).toBe('active');
    expect(pickParam('', allowed, 'active')).toBe('active');
    expect(pickParam('everyone', allowed, 'active')).toBe('active');
  });
});

describe('withParam', () => {
  it('sets the value and keeps the rest of the address', () => {
    expect(withParam('https://x.test/clients?q=ann#top', 'filter', 'missed', 'active')).toBe('/clients?q=ann&filter=missed#top');
  });
  it('leaves the default out, so a plain page keeps a plain address', () => {
    expect(withParam('https://x.test/clients?filter=missed&q=ann', 'filter', 'active', 'active')).toBe('/clients?q=ann');
    expect(withParam('https://x.test/clients?filter=missed', 'filter', 'active', 'active')).toBe('/clients');
  });
  it('replaces a value already there', () => {
    expect(withParam('https://x.test/home?chip=missed', 'chip', 'scans', 'all')).toBe('/home?chip=scans');
  });
});
