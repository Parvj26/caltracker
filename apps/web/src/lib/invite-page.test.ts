import { describe, expect, it } from 'vitest';
import { inviteUrlFrom, isMobileUserAgent, qrSvg, storeLinks } from './invite-page';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';

describe('isMobileUserAgent', () => {
  it('spots phones', () => {
    expect(isMobileUserAgent(IPHONE)).toBe(true);
    expect(isMobileUserAgent(PIXEL)).toBe(true);
  });
  it('treats computers as non-mobile', () => {
    expect(isMobileUserAgent(MAC)).toBe(false);
    expect(isMobileUserAgent(WINDOWS)).toBe(false);
  });
  it('treats a missing user agent as mobile', () => {
    expect(isMobileUserAgent(null)).toBe(true);
    expect(isMobileUserAgent('')).toBe(true);
  });
});

describe('inviteUrlFrom', () => {
  it('builds the invite URL from the host', () => {
    expect(inviteUrlFrom('caltracker.app', 'https', 'abc_DEF-123')).toBe('https://caltracker.app/invite/abc_DEF-123');
    expect(inviteUrlFrom('localhost:3000', null, 'abc')).toBe('http://localhost:3000/invite/abc');
    expect(inviteUrlFrom('caltracker.app', null, 'abc')).toBe('https://caltracker.app/invite/abc');
  });
  it('refuses a missing or odd host', () => {
    expect(inviteUrlFrom(null, 'https', 'abc')).toBeNull();
    expect(inviteUrlFrom('evil.com/x?', 'https', 'abc')).toBeNull();
  });
  it('ignores an unknown protocol', () => {
    expect(inviteUrlFrom('caltracker.app', 'javascript', 'abc')).toBe('https://caltracker.app/invite/abc');
  });
});

describe('qrSvg', () => {
  it('returns an inline SVG in brand ink', async () => {
    const svg = await qrSvg('https://caltracker.app/invite/abc');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('#121212');
    expect(svg).not.toContain('<script');
    // Only shapes: no links, no external images.
    expect(svg).not.toMatch(/<image|<a[\s>]|href=/);
  });
});

describe('storeLinks', () => {
  it('is empty when no store URL is set', () => {
    expect(storeLinks(undefined, undefined)).toEqual([]);
    expect(storeLinks('', '')).toEqual([]);
  });
  it('lists only the configured stores', () => {
    expect(storeLinks('https://apps.apple.com/x', undefined)).toEqual([{ label: 'App Store', href: 'https://apps.apple.com/x' }]);
    expect(storeLinks('a', 'b').map((l) => l.label)).toEqual(['App Store', 'Google Play']);
  });
});
