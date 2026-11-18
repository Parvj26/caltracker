import { describe, expect, it } from 'vitest';
import { readExerciseFilters, withExerciseFilters } from './filter-url';

const read = (q: string) => readExerciseFilters(new URLSearchParams(q));

describe('exercise filters in the address', () => {
  it('reads known chips and drops unknown or repeated ones', () => {
    expect(read('muscle=Chest,Nope,Chest,Back&equipment=Barbell,x&custom=1&fav=1')).toEqual({
      muscles: ['Chest', 'Back'],
      equipment: ['Barbell'],
      customOnly: true,
      favourites: true,
    });
    expect(read('')).toEqual({ muscles: [], equipment: [], customOnly: false, favourites: false });
  });

  it('still honours the older ?source=custom link', () => {
    expect(read('source=custom').customOnly).toBe(true);
  });

  it('writes filters in and leaves out empty ones, keeping the search text', () => {
    const href = 'https://x.test/exercises?q=row&source=custom';
    expect(withExerciseFilters(href, { muscles: ['Back', 'Arms'], customOnly: false, favourites: true })).toBe('/exercises?q=row&muscle=Back%2CArms&fav=1');
    expect(withExerciseFilters('https://x.test/exercises?muscle=Back&fav=1', { muscles: [], favourites: false })).toBe('/exercises');
  });
});
