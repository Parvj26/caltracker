import { describe, expect, it } from 'vitest';
import { buildSmartIndex, normalizeSearchText, smartMatch } from '../../src/search';

type Item = { name: string };
const names = ['Chicken & rice', 'Egg white wrap', 'Crème brûlée', 'Protein oats', 'Oat bowl', 'Greek yogurt bowl'];
const index = buildSmartIndex<Item>(names.map((name) => ({ name })), (i) => ({ name: i.name }));
const hit = (q: string, name: string) => smartMatch(index, q).find((h) => h.item.name === name);

describe('smart search', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeSearchText('  Crème-Brûlée!! ')).toBe('creme brulee');
  });

  it('forgives a typo', () => {
    expect(hit('chiken', 'Chicken & rice')?.tier).toBe(4);
  });

  it('ignores word order', () => {
    expect(hit('rice chicken', 'Chicken & rice')?.tier).toBe(3);
  });

  it('matches plurals by stem', () => {
    expect(hit('eggs', 'Egg white wrap')).toBeDefined();
  });

  it('ignores accents', () => {
    expect(hit('creme brulee', 'Crème brûlée')?.tier).toBe(1);
  });

  it('ranks exact, starts-with and contains', () => {
    expect(hit('oat bowl', 'Oat bowl')?.tier).toBe(1);
    expect(hit('oat', 'Oat bowl')?.tier).toBe(2);
    expect(hit('oat', 'Protein oats')?.tier).toBe(3);
  });

  it('matches a partial word', () => {
    expect(hit('yog', 'Greek yogurt bowl')?.tier).toBe(3);
  });

  it('highlights the matched words', () => {
    expect(hit('oat', 'Protein oats')?.highlight).toEqual([[8, 12]]);
  });

  it('needs every query word to match', () => {
    expect(hit('oat chicken', 'Oat bowl')).toBeUndefined();
  });

  it('finds nothing for unrelated, emoji-only or punctuation-only queries', () => {
    expect(smartMatch(index, 'xyz')).toEqual([]);
    expect(smartMatch(index, '🍕')).toEqual([]);
    expect(smartMatch(index, '!!!')).toEqual([]);
    expect(smartMatch(index, '')).toEqual([]);
  });

  it('copes with a single letter and very long input', () => {
    expect(hit('o', 'Oat bowl')?.tier).toBe(2);
    expect(() => smartMatch(index, 'x'.repeat(60))).not.toThrow();
    expect(smartMatch(index, 'chicken '.repeat(8))).toHaveLength(1);
  });

  it('matches extra words at the lowest tier', () => {
    const idx = buildSmartIndex([{ name: 'Overnight oats' }], (i) => ({ name: i.name, extraWords: ['breakfast'] }));
    expect(smartMatch(idx, 'breakfast')[0]?.tier).toBe(5);
  });
});
