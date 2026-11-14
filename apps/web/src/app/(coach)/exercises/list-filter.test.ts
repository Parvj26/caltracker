import { describe, expect, it } from 'vitest';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { matchesListFilter, sheetFilterCount } from './list-filter';

const row = (over: Partial<ExerciseIndexRow> = {}): ExerciseIndexRow => ({
  id: 'a',
  name: 'Barbell Squat',
  primaryMuscles: ['quadriceps'],
  secondaryMuscles: [],
  equipment: 'barbell',
  category: 'strength',
  trackingType: 'weight_reps',
  source: 'builtin',
  imagePath: null,
  ...over,
});
const none = { tracking: '', builtinOnly: false, favouritesOnly: false };
const noFavs = new Set<string>();

describe('matchesListFilter', () => {
  it('lets every row through with nothing set', () => {
    expect(matchesListFilter(row(), none, noFavs)).toBe(true);
    expect(matchesListFilter(row({ source: 'custom' }), none, noFavs)).toBe(true);
  });
  it('keeps only the chosen tracking type', () => {
    expect(matchesListFilter(row(), { ...none, tracking: 'weight_reps' }, noFavs)).toBe(true);
    expect(matchesListFilter(row(), { ...none, tracking: 'time' }, noFavs)).toBe(false);
  });
  it('hides custom exercises for ?source=builtin', () => {
    expect(matchesListFilter(row({ source: 'custom' }), { ...none, builtinOnly: true }, noFavs)).toBe(false);
    expect(matchesListFilter(row(), { ...none, builtinOnly: true }, noFavs)).toBe(true);
  });
  it('keeps only starred rows with Favourites on', () => {
    const f = { ...none, favouritesOnly: true };
    expect(matchesListFilter(row(), f, noFavs)).toBe(false);
    expect(matchesListFilter(row(), f, new Set(['a']))).toBe(true);
  });
});

describe('sheetFilterCount', () => {
  it('counts what is set inside the Filters sheet (not the muscle chips on the page)', () => {
    expect(sheetFilterCount({ muscles: ['Chest'], equipment: [], customOnly: false }, '')).toBe(0);
    expect(sheetFilterCount({ muscles: [], equipment: ['Barbell', 'Cable'], customOnly: true }, 'time')).toBe(4);
  });
});
