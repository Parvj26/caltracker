import { describe, expect, it } from 'vitest';
import {
  COACH_MEAL_CHIPS,
  filterCoachMeals,
  frequentMeals,
  mealSearchItems,
  mealSearchMeta,
  searchMeals,
  type CoachMeal,
  type CoachMealChip,
  type HistoryMeal,
} from '../../src/food/meal-search';
import type { MealMacros } from '../../src/food/food';

const TODAY = '2026-11-09';
const mac = (calories: number | null, protein: number | null = null, carbs: number | null = null, fat: number | null = null): MealMacros => ({
  calories,
  protein,
  carbs,
  fat,
});
let n = 0;
function meal(name: string | null, macros: MealMacros, eatenOn: string, extra: Partial<HistoryMeal> = {}): HistoryMeal {
  n += 1;
  return { id: `m${n}`, eatenOn, eatenAt: `${eatenOn}T12:00:${String(n % 60).padStart(2, '0')}Z`, name, macros, hasPhoto: false, coachMealId: null, ...extra };
}
function coach(id: string, name: string, macros: MealMacros): CoachMeal {
  return { id, name, macros, ingredients: '', howTo: '', photo: null, updatedAt: '2026-11-01T00:00:00Z' };
}

describe('frequentMeals', () => {
  it('lists the three most logged named meals with a macro', () => {
    const yog = mac(320, 28);
    const history = [
      meal('Greek yogurt bowl', yog, '2026-11-01'),
      meal('Greek yogurt bowl', yog, '2026-11-03'),
      meal('Greek yogurt bowl', yog, '2026-11-05'),
      meal('Chicken & rice', mac(610, 48), '2026-11-02'),
      meal('Chicken & rice', mac(610, 48), '2026-11-04'),
      meal('Protein shake', mac(180, 30), '2026-11-06'),
      ...Array.from({ length: 4 }, () => meal('Pizza', mac(null), '2026-11-07', { hasPhoto: true })),
      ...Array.from({ length: 5 }, () => meal(null, mac(500), '2026-11-07')),
    ];
    expect(frequentMeals(history, TODAY).map((m) => m.name)).toEqual(['Greek yogurt bowl', 'Chicken & rice', 'Protein shake']);
  });

  it('keeps meals with the same name but different numbers apart', () => {
    const out = frequentMeals([meal('Breakfast', mac(400), '2026-11-08'), meal('Breakfast', mac(450), '2026-11-07')], TODAY);
    expect(out.map((m) => [m.name, m.count, m.macros.calories])).toEqual([
      ['Breakfast', 1, 400],
      ['Breakfast', 1, 450],
    ]);
  });

  it('only looks back 28 days', () => {
    expect(frequentMeals([meal('Old', mac(100), '2026-10-11')], TODAY)).toEqual([]);
    expect(frequentMeals([meal('Recent', mac(100), '2026-10-13')], TODAY)).toHaveLength(1);
  });

  it('groups spellings and shows the most recent one', () => {
    const out = frequentMeals([meal('Greek yogurt bowl', mac(320), '2026-11-01'), meal('greek  Yogurt Bowl', mac(320), '2026-11-02')], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('greek  Yogurt Bowl');
    expect(out[0]?.count).toBe(2);
  });

  it('breaks ties by most recent and carries the coach link', () => {
    const out = frequentMeals(
      [meal('A', mac(1), '2026-11-01'), meal('B', mac(2), '2026-11-05', { coachMealId: 'c1' })],
      TODAY,
    );
    expect(out.map((m) => m.name)).toEqual(['B', 'A']);
    expect(out[0]?.coachMealId).toBe('c1');
  });
});

describe('searchMeals', () => {
  const own = [
    ...Array.from({ length: 6 }, (_, i) => meal('Chicken & rice', mac(610, 48, 62, 14), `2026-11-0${i + 1}`)),
    meal('Chicken wrap', mac(520, 38, 44, 20), '2026-11-05'),
  ];
  const coachMeals = [coach('cb', 'Chicken burrito bowl', mac(620, 52, 64, 16))];

  it('ranks own meals by count, then coach meals', () => {
    const items = mealSearchItems(own, coachMeals, TODAY);
    expect(searchMeals(items, 'chicken').map((i) => i.name)).toEqual(['Chicken & rice', 'Chicken wrap', 'Chicken burrito bowl']);
  });

  it('forgives typos', () => {
    const items = mealSearchItems(own, coachMeals, TODAY);
    expect(searchMeals(items, 'chiken bowl').map((i) => i.name)).toEqual(['Chicken burrito bowl']);
  });

  it('lists nothing until something is typed', () => {
    expect(searchMeals(mealSearchItems(own, coachMeals, TODAY), '')).toEqual([]);
    expect(searchMeals(mealSearchItems(own, coachMeals, TODAY), '  ')).toEqual([]);
  });

  it('shows at most 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => meal(`Toast ${i}`, mac(100 + i), '2026-11-08'));
    expect(searchMeals(mealSearchItems(many, [], TODAY), 'toast')).toHaveLength(8);
  });

  it('folds own meals logged from a coach meal into it', () => {
    const fromCoach = [
      meal('Chicken burrito bowl', mac(620, 52, 64, 16), '2026-11-07', { coachMealId: 'cb' }),
      meal('Chicken burrito bowl', mac(600, 52, 64, 16), '2026-11-08', { coachMealId: 'cb' }),
    ];
    const items = mealSearchItems(fromCoach, coachMeals, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'coach', coachMealId: 'cb', count: 2, lastEatenOn: '2026-11-08' });
  });

  it('keeps own meals linked to a coach meal that is gone', () => {
    const items = mealSearchItems([meal('Old chili', mac(500), '2026-11-07', { coachMealId: 'gone' })], coachMeals, TODAY);
    expect(items.find((i) => i.name === 'Old chili')).toMatchObject({ source: 'own', coachMealId: 'gone' });
  });

  it('copes with odd input', () => {
    const items = mealSearchItems([meal('Crème brûlée', mac(300), '2026-11-08')], [], TODAY);
    expect(searchMeals(items, 'creme brulee').map((i) => i.name)).toEqual(['Crème brûlée']);
    expect(searchMeals(items, '🍕')).toEqual([]);
    expect(searchMeals(items, '!!!')).toEqual([]);
    expect(searchMeals(items, 'c')).toHaveLength(1);
    expect(() => searchMeals(items, 'x'.repeat(60))).not.toThrow();
  });
});

describe('mealSearchMeta', () => {
  const base = { key: 'k', name: 'x', macros: mac(610, 48, 62, 14), coachMealId: null, lastEatenAt: null };
  it('says how often an own meal was logged', () => {
    expect(mealSearchMeta({ ...base, source: 'own', count: 6, lastEatenOn: '2026-11-08' }, TODAY)).toBe(
      '610 kcal · 48 P · 62 C · 14 F · logged 6 times',
    );
  });
  it('says when a meal logged once was eaten', () => {
    expect(mealSearchMeta({ ...base, source: 'own', count: 1, lastEatenOn: '2026-11-05' }, TODAY)).toBe('610 kcal · 48 P · 62 C · 14 F · last Thu');
    expect(mealSearchMeta({ ...base, source: 'own', count: 1, lastEatenOn: '2026-11-08' }, TODAY)).toBe('610 kcal · 48 P · 62 C · 14 F · yesterday');
    expect(mealSearchMeta({ ...base, source: 'own', count: 1, lastEatenOn: '2026-10-20' }, TODAY)).toBe('610 kcal · 48 P · 62 C · 14 F · Tue 20 Oct');
  });
  it('marks coach meals as recipes', () => {
    expect(mealSearchMeta({ ...base, source: 'coach', count: 0, lastEatenOn: null }, TODAY)).toBe('610 kcal · 48 P · 62 C · 14 F · recipe');
  });
});

describe('filterCoachMeals', () => {
  const meals = [
    coach('1', 'Protein oats', mac(450, 35, 52, 11)),
    coach('2', 'Salad', mac(300, 29.9, 20, 10)),
    coach('3', 'Big bowl', mac(501, null, 80, 20)),
    coach('4', 'Éclair', mac(500, 30, 21, 9)),
  ];
  const f = (q: string, chips: CoachMealChip[]) => filterCoachMeals(meals, q, new Set(chips)).map((m) => m.name);

  it('lists the chips in order', () => {
    expect(COACH_MEAL_CHIPS.map((c) => c.label)).toEqual(['High protein', 'Under 500 kcal', 'Low carb']);
  });
  it('lists everything A to Z with no search or chips, ignoring accents', () => {
    expect(f('', [])).toEqual(['Big bowl', 'Éclair', 'Protein oats', 'Salad']);
  });
  it('high protein is at least 30 g; a missing number never matches', () => {
    expect(f('', ['highProtein'])).toEqual(['Éclair', 'Protein oats']);
  });
  it('under 500 kcal includes 500', () => {
    expect(f('', ['under500'])).toEqual(['Éclair', 'Protein oats', 'Salad']);
  });
  it('low carb is at most 20 g', () => {
    expect(f('', ['lowCarb'])).toEqual(['Salad']);
  });
  it('combines chips and search with AND', () => {
    expect(f('', ['highProtein', 'under500'])).toEqual(['Éclair', 'Protein oats']);
    expect(f('oats', ['highProtein'])).toEqual(['Protein oats']);
    expect(f('oats', ['lowCarb'])).toEqual([]);
  });
});
