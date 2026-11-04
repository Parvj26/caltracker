import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('allows the two known pages', () => {
    expect(safeNextPath('/set-password')).toBe('/set-password');
    expect(safeNextPath('/clients')).toBe('/clients');
  });
  it.each([
    null,
    '',
    '//evil.com',
    '/\tevil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/\t\\evil.com',
    '/%09/evil.com',
    'https://evil.com',
    '/clients/../admin',
    '/exercises',
    '/set-password?x=1',
  ])('falls back to /clients for %j', (value) => {
    expect(safeNextPath(value)).toBe('/clients');
  });
});
