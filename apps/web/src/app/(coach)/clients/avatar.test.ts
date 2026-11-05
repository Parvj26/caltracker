import { describe, expect, it } from 'vitest';
import { avatarTone, initials } from './avatar';

describe('initials', () => {
  it.each([
    ['Demo Client', 'DC'],
    ['sam', 'S'],
    ['  Priya   van der Rao ', 'PR'],
    ['élodie durand', 'ÉD'],
    ['', '?'],
  ])('%j -> %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('avatarTone', () => {
  it('is stable for the same key and always a pastel', () => {
    expect(avatarTone('abc')).toBe(avatarTone('abc'));
    for (const key of ['a', 'b', 'c', 'user-1', 'user-2', '']) {
      expect(['lime', 'pink', 'blue']).toContain(avatarTone(key));
    }
  });
});
