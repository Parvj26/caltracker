import { describe, expect, it } from 'vitest';
import { BIO_MAX_LENGTH, Bio, BusinessName, ProfileInput, characterCount } from '../../src/index';

describe('Bio', () => {
  it('allows empty, 300 characters, and trims the ends', () => {
    expect(Bio.parse('')).toBe('');
    expect(Bio.parse('a'.repeat(300))).toHaveLength(300);
    expect(Bio.parse('  hello  ')).toBe('hello');
  });
  it('rejects 301 characters', () => {
    expect(Bio.safeParse('a'.repeat(301)).success).toBe(false);
  });
  it('keeps line breaks and turns Windows ones into \\n', () => {
    expect(Bio.parse('one\r\ntwo\rthree\nfour')).toBe('one\ntwo\nthree\nfour');
  });
  it('counts an emoji as one character, like the database', () => {
    expect(characterCount('💪')).toBe(1);
    expect(Bio.safeParse('💪'.repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse('💪'.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('BusinessName', () => {
  it('trims and allows 1 to 80 characters', () => {
    expect(BusinessName.parse('  Iron Works  ')).toBe('Iron Works');
    expect(BusinessName.safeParse('a'.repeat(80)).success).toBe(true);
  });
  it('rejects blank and 81 characters', () => {
    expect(BusinessName.safeParse('').success).toBe(false);
    expect(BusinessName.safeParse('   ').success).toBe(false);
    expect(BusinessName.safeParse('a'.repeat(81)).success).toBe(false);
  });
});

describe('ProfileInput', () => {
  const ok = { firstName: 'Sam', lastName: '', businessName: 'Gym', bio: '', units: 'kg' };
  it('accepts a complete profile', () => {
    expect(ProfileInput.safeParse(ok).success).toBe(true);
  });
  it('needs a first name and a known unit', () => {
    expect(ProfileInput.safeParse({ ...ok, firstName: ' ' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...ok, units: 'stone' }).success).toBe(false);
  });
});
