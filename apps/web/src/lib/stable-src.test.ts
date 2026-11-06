import { describe, expect, it } from 'vitest';
import { sameImage } from './stable-src';

const base = 'http://127.0.0.1:54321/storage/v1/object/sign/avatars/u1/avatar-thumb.webp';

describe('sameImage', () => {
  it('is the same image when only the token differs', () => {
    expect(sameImage(`${base}?token=aaa&v=1`, `${base}?token=bbb&v=1`)).toBe(true);
  });
  it('a new photo version is a different image', () => {
    expect(sameImage(`${base}?token=aaa&v=1`, `${base}?token=aaa&v=2`)).toBe(false);
  });
  it('a different file is a different image', () => {
    expect(sameImage(`${base}?token=a&v=1`, `${base.replace('u1', 'u2')}?token=a&v=1`)).toBe(false);
  });
  it('anything that is not a URL only matches itself', () => {
    expect(sameImage('not a url', 'not a url')).toBe(true);
    expect(sameImage('not a url', 'other')).toBe(false);
  });
});
