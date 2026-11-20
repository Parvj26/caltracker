import { describe, expect, it } from 'vitest';
import { USUAL_MEAL_MINUTES, macroSumHint, mealTitle, mealTypeForMinutes, mealTypeForTime, mealTypeTag } from '../../src';

const at = (h: number, m = 0) => h * 60 + m;

describe('mealTypeForMinutes', () => {
  it.each([
    [at(4), 'Breakfast'],
    [at(7, 30), 'Breakfast'],
    [at(10, 59), 'Breakfast'],
    [at(11), 'Lunch'],
    [at(14, 59), 'Lunch'],
    [at(15), 'Snack'],
    [at(16, 59), 'Snack'],
    [at(17), 'Dinner'],
    [at(21, 59), 'Dinner'],
    [at(22), 'Snack'],
    [at(0, 30), 'Snack'],
    [at(3, 59), 'Snack'],
  ] as const)('%i minutes is %s', (minutes, type) => expect(mealTypeForMinutes(minutes)).toBe(type));

  it('wraps minutes outside one day', () => {
    expect(mealTypeForMinutes(at(24 + 8))).toBe('Breakfast');
    expect(mealTypeForMinutes(-60)).toBe('Snack');
  });

  it('gives each type a usual time inside its own range', () => {
    for (const [type, minutes] of Object.entries(USUAL_MEAL_MINUTES)) expect(mealTypeForMinutes(minutes)).toBe(type);
  });
});

describe('mealTypeForTime', () => {
  it('reads the clock in the given time zone', () => {
    // 12:15 UTC is 12:15 in London (winter), 07:15 in New York and 01:15 next day in Auckland (summer).
    expect(mealTypeForTime('2026-11-19T12:15:00Z', 'Europe/London')).toBe('Lunch');
    expect(mealTypeForTime('2026-11-19T12:15:00Z', 'America/New_York')).toBe('Breakfast');
    expect(mealTypeForTime('2026-11-19T12:15:00Z', 'Pacific/Auckland')).toBe('Snack');
  });
});

describe('mealTitle and mealTypeTag', () => {
  const lunch = '2026-11-19T12:15:00Z';
  it('falls back to the meal type when there is no name', () => {
    expect(mealTitle({ name: null, eatenAt: lunch }, 'UTC')).toBe('Lunch');
    expect(mealTitle({ name: '  ', eatenAt: lunch }, 'UTC')).toBe('Lunch');
    expect(mealTitle({ name: ' Tuna wrap ', eatenAt: lunch }, 'UTC')).toBe('Tuna wrap');
  });
  it('tags a named meal with its type, but never repeats it', () => {
    expect(mealTypeTag({ name: 'Tuna wrap', eatenAt: lunch }, 'UTC')).toBe('Lunch');
    expect(mealTypeTag({ name: 'lunch', eatenAt: lunch }, 'UTC')).toBeNull();
    expect(mealTypeTag({ name: null, eatenAt: lunch }, 'UTC')).toBeNull();
  });
});

describe('macroSumHint', () => {
  const m = (calories: number | null, protein: number | null, carbs: number | null, fat: number | null) => ({ calories, protein, carbs, fat });
  it('adds protein, carbs and fat (4/4/9)', () => {
    expect(macroSumHint(m(450, 40, 30, 18))).toBe('≈ 442 kcal from macros');
    expect(macroSumHint(m(null, 10, null, null))).toBe('≈ 40 kcal from macros');
  });
  it('says nothing until one of the three is filled', () => {
    expect(macroSumHint(m(450, null, null, null))).toBeNull();
  });
  it('groups thousands', () => {
    expect(macroSumHint(m(null, 100, 200, 50))).toBe('≈ 1,650 kcal from macros');
  });
});
