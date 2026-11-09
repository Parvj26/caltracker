import { describe, expect, it } from 'vitest';
import { foodPeriodDays, foodPeriodSummary, foodTile } from '../../src/progress/food';

// Thursday 5 November 2026.
const today = '2026-11-05';
const meal = (eatenOn: string, calories: number | null, protein: number | null, hasPhoto = false) => ({
  eatenOn,
  hasPhoto,
  macros: { calories, protein, carbs: null, fat: null },
});
const targets = { calories: 2000, protein: 150, carbs: null, fat: null };

describe('foodPeriodDays', () => {
  it('is Monday to Sunday for this week, and the 28 days up to today for the last 4 weeks', () => {
    expect(foodPeriodDays('week', today)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    const four = foodPeriodDays('4w', today);
    expect(four).toHaveLength(28);
    expect(four[0]).toBe('2026-10-09');
    expect(four.at(-1)).toBe(today);
  });
});

describe('foodPeriodSummary', () => {
  const days = foodPeriodDays('week', today);
  const meals = [
    meal('2026-11-02', 1000, 80, true),
    meal('2026-11-02', 1100, 80),
    meal('2026-11-03', 1800, 100),
    meal('2026-11-04', 2000, null),
    meal('2026-10-30', 9999, 999), // outside the week
  ];

  it('averages each macro over the days it was logged, against the targets', () => {
    const s = foodPeriodSummary(meals, targets, days, today);
    const cal = s.macros.find((m) => m.key === 'calories')!;
    expect(cal).toMatchObject({ average: 1967, target: 2000, text: '1,967 / 2,000 kcal', label: 'Calories: 1,967 kcal a day on average, 98% of target' });
    expect(cal.fraction).toBeCloseTo(0.98, 2);
    const protein = s.macros.find((m) => m.key === 'protein')!;
    expect(protein).toMatchObject({ average: 130, target: 150, text: '130 / 150 g' });
    const carbs = s.macros.find((m) => m.key === 'carbs')!;
    expect(carbs).toMatchObject({ average: null, target: null, fraction: null, text: 'Not logged' });
    expect(s).toMatchObject({ loggedDays: 3, mealCount: 4, photoCount: 1, hasTargets: true });
  });

  it('marks each day hit, under, nothing logged, or still to come', () => {
    const s = foodPeriodSummary(meals, targets, days, today);
    expect(s.proteinDays!.map((d) => d.state)).toEqual(['hit', 'under', 'none', 'none', 'future', 'future', 'future']);
    expect(s.proteinDays![0]).toMatchObject({ dow: 'Mon', label: 'Mon: protein target hit' });
    expect(s.proteinDays![1]!.label).toBe('Tue: logged, under target');
    expect(s.proteinDays![3]!.label).toBe('Thu: nothing logged');
    expect(s).toMatchObject({ hitDays: 1, sentence: 'Hit on 1 of 2 days logged. Nice.' });
  });

  it('judges only days with protein entered: a day of calories only is not under target', () => {
    const s = foodPeriodSummary([meal('2026-11-02', 2000, null), meal('2026-11-03', 2000, 160)], targets, days, today);
    expect(s.proteinDays!.slice(0, 2).map((d) => d.state)).toEqual(['none', 'hit']);
    expect(s.proteinDays![0]!.label).toBe('Mon: no protein logged');
    expect(s.sentence).toBe('Hit on 1 of 1 day logged. Nice.');
  });

  it('shows averages only when the protein target is 0', () => {
    const s = foodPeriodSummary(meals, { ...targets, protein: 0 }, days, today);
    expect(s.proteinDays).toBeNull();
    expect(s.hitDays).toBe(0);
  });

  it('cheers when the target was hit on most logged days', () => {
    const s = foodPeriodSummary([meal('2026-11-02', 2000, 150), meal('2026-11-03', 2000, 160)], targets, days, today);
    expect(s.sentence).toBe('Hit on 2 of 2 days logged. Nice.');
  });

  it('shows averages only with no targets, and says so when nothing is logged', () => {
    const s = foodPeriodSummary(meals, null, days, today);
    expect(s.hasTargets).toBe(false);
    expect(s.proteinDays).toBeNull();
    expect(s.macros.find((m) => m.key === 'calories')).toMatchObject({ text: '1,967 kcal', fraction: null });
    expect(foodPeriodSummary([], targets, days, today).sentence).toBe('No meals logged in this period yet.');
  });
});

describe('foodTile', () => {
  it('shows the protein days with a target, meals without, and an invitation with nothing', () => {
    expect(foodTile({ hitDays: 4, loggedDays: 6, mealCount: 20, hasProteinTarget: true })).toEqual({ value: '4 of 6', sub: 'days on protein target' });
    expect(foodTile({ hitDays: 0, loggedDays: 2, mealCount: 5, hasProteinTarget: false })).toEqual({ value: '5 meals', sub: 'logged this week' });
    expect(foodTile({ hitDays: 0, loggedDays: 1, mealCount: 1, hasProteinTarget: false })).toEqual({ value: '1 meal', sub: 'logged this week' });
    expect(foodTile({ hitDays: 0, loggedDays: 0, mealCount: 0, hasProteinTarget: true })).toEqual({ value: 'No meals yet', sub: 'this week' });
    expect(foodTile({ hitDays: 0, loggedDays: 0, mealCount: 2, hasProteinTarget: true })).toEqual({ value: '2 meals', sub: 'logged this week' });
  });
});
