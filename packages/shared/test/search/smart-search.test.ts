import { describe, expect, it } from 'vitest';
import { buildSmartIndex, normalizeSearchText, smartFilter, smartMatch } from '../../src/search';
import { LIBRARY } from '../exercises/fixtures/library';

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

describe('smartFilter', () => {
  const workouts = ['Upper body A', 'Lower body B', 'Full body conditioning', 'Mobility flow'].map((name) => ({ name }));
  const find = (q: string) => smartFilter(workouts, q, (w) => w.name).map((w) => w.name);

  it('keeps everything, in the given order, for a blank query', () => {
    expect(find('')).toEqual(['Upper body A', 'Lower body B', 'Full body conditioning', 'Mobility flow']);
    expect(find('   ')).toEqual(['Upper body A', 'Lower body B', 'Full body conditioning', 'Mobility flow']);
  });

  it('forgives typos, partial words and word order', () => {
    expect(find('mobilty')).toEqual(['Mobility flow']);
    expect(find('cond')).toEqual(['Full body conditioning']);
    expect(find('body lower')).toEqual(['Lower body B']);
  });

  it('puts better matches first and keeps the given order within a tier', () => {
    expect(find('body')).toEqual(['Upper body A', 'Lower body B', 'Full body conditioning']);
    expect(find('lower')).toEqual(['Lower body B']);
  });
});

describe('typos in short words', () => {
  const workouts = ['Upper Pull A', 'Upper Push B', 'Lower body', 'Leg day', 'Full body conditioning'].map((name) => ({ name }));
  const find = (q: string) => smartFilter(workouts, q, (w) => w.name).map((w) => w.name);
  const clients = ['Maya Patel', 'Mia Wong', 'Sam Lee', 'Liam Brown'].map((name) => ({ name }));
  const client = (q: string) => smartFilter(clients, q, (c) => c.name).map((c) => c.name);

  it('forgives one missing, extra, wrong or swapped letter in a 3-4 letter word', () => {
    expect(find('uper pul')).toEqual(['Upper Pull A']);
    expect(client('mya')).toEqual(['Maya Patel', 'Mia Wong']); // a missing letter, or a wrong one
    expect(find('lge')).toEqual(['Leg day']); // swapped
    expect(find('pish')).toEqual(['Upper Push B']); // wrong letter
    expect(client('lim')).toEqual(['Liam Brown']); // missing letter
    expect(find('uppr')).toEqual(['Upper Pull A', 'Upper Push B']);
  });

  it('forgives no typo in a word under 3 letters', () => {
    expect(client('ma')).toEqual(['Maya Patel']);
    expect(client('mu')).toEqual([]);
    expect(find('lg')).toEqual([]);
  });

  it('keeps the old rule for 5+ letters', () => {
    expect(find('lowre')).toEqual(['Lower body']);
    expect(find('condtioning')).toEqual(['Full body conditioning']);
  });

  it('ranks typo matches after exact and starts-with matches', () => {
    const idx = buildSmartIndex(['Maya Patel', 'Myah Jones'].map((name) => ({ name })), (i) => ({ name: i.name }));
    const hits = smartMatch(idx, 'mya');
    // "mya" starts "Myah", so it isn't treated as a typo and doesn't pull in Maya.
    expect(hits.map((h) => [h.item.name, h.tier])).toEqual([['Myah Jones', 2]]);
  });
});

describe('short-word typos stay quiet in the real exercise library', () => {
  const index = buildSmartIndex(LIBRARY, (r) => ({ name: r.name }));
  const names = (q: string) => smartMatch(index, q).map((h) => h.item.name);
  const typos = (q: string) => smartMatch(index, q).filter((h) => h.tier === 4).map((h) => h.item.name);

  // A real word that already matches as typed is taken at its word: no look-alikes one letter away.
  it.each([
    ['leg', /\b(log|keg)\b/i], // Log Lift, Keg Load
    ['dip', /\bhip\b/i], // Barbell Hip Thrust
    ['row', /\blow\b/i], // Low Cable Crossover
    ['pull', /\bfull\b/i], // Barbell Full Squat
    ['band', /\bbend\b/i], // Dumbbell Side Bend
    ['ball', /\b(bell|wall)\b/i], // Circus Bell
    ['back', /\b(hack|rack)\b/i], // Hack Squat
    ['calf', /\bhalf\b/i], // One Half Locust
  ])('"%s" finds no look-alike words', (q, lookAlike) => {
    expect(typos(q)).toEqual([]);
    expect(names(q).filter((n) => lookAlike.test(n) && !new RegExp(`\\b${q}`, 'i').test(n))).toEqual([]);
  });

  it('still forgives a typo in a short word', () => {
    expect(names('lge prss')).toContain('Leg Press');
    expect(names('dpi')).toContain('Dips - Triceps Version');
  });
});
