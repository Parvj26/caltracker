import { describe, expect, it } from 'vitest';
import {
  MACRO_KEYS,
  MEAL_NAME_MAX,
  MEAL_NOTE_MAX,
  dailyTotals,
  foodDayLabel,
  formatMacro,
  formatMealTime,
  hasAnyMacro,
  hasAnyTarget,
  kcalFromMacros,
  kcalHint,
  macroProgress,
  mealPhotoPaths,
  mealProblems,
  mealMacroLine,
  mealReference,
  mealsByDay,
  parseMacroInput,
  weekDays,
  type MealMacros,
} from '../../src/food/food';

const none: MealMacros = { calories: null, protein: null, carbs: null, fat: null };

describe('kcalFromMacros', () => {
  it('uses 4 kcal per gram of protein and carbs and 9 per gram of fat', () => {
    expect(kcalFromMacros({ ...none, protein: 30, carbs: 50, fat: 20 })).toBe(500);
  });
  it('counts only the macros that are filled', () => {
    expect(kcalFromMacros({ ...none, protein: 25 })).toBe(100);
  });
  it('is null when no gram macro is filled (calories alone do not count)', () => {
    expect(kcalFromMacros(none)).toBeNull();
    expect(kcalFromMacros({ ...none, calories: 400 })).toBeNull();
  });
  it('rounds to a whole number', () => {
    expect(kcalFromMacros({ ...none, fat: 10.5 })).toBe(95);
  });
});

describe('kcalHint', () => {
  it('suggests calories from macros when calories are blank', () => {
    expect(kcalHint({ ...none, protein: 30, carbs: 50, fat: 20 })).toBe('≈ 500 kcal from macros');
  });
  it('says nothing when calories are filled or no macros are', () => {
    expect(kcalHint({ ...none, calories: 450, protein: 30 })).toBeNull();
    expect(kcalHint(none)).toBeNull();
  });
  it('groups thousands', () => {
    expect(kcalHint({ ...none, fat: 200 })).toBe('≈ 1,800 kcal from macros');
  });
});

describe('parseMacroInput', () => {
  it('reads blank as no value', () => {
    expect(parseMacroInput('protein', '  ')).toEqual({ value: null });
  });
  it('reads numbers, a comma decimal and rounds grams to one decimal and calories to whole', () => {
    expect(parseMacroInput('protein', '32.46')).toEqual({ value: 32.5 });
    expect(parseMacroInput('fat', '12,5')).toEqual({ value: 12.5 });
    expect(parseMacroInput('calories', '512.6')).toEqual({ value: 513 });
  });
  it('refuses text, negatives and values over the limit', () => {
    expect(parseMacroInput('carbs', 'lots')).toEqual({ error: 'Enter carbs as a number of grams.' });
    expect(parseMacroInput('carbs', '-1')).toEqual({ error: 'Enter carbs as a number of grams.' });
    expect(parseMacroInput('carbs', '1000.1')).toEqual({ error: 'Carbs can be at most 1,000 g.' });
    expect(parseMacroInput('calories', '10001')).toEqual({ error: 'Calories can be at most 10,000 kcal.' });
    expect(parseMacroInput('calories', 'abc')).toEqual({ error: 'Enter calories as a number.' });
  });
  it('accepts the limits themselves and zero', () => {
    expect(parseMacroInput('protein', '1000')).toEqual({ value: 1000 });
    expect(parseMacroInput('calories', '0')).toEqual({ value: 0 });
  });
});

describe('hasAnyMacro / hasAnyTarget', () => {
  it('is true when any of the four is a number', () => {
    expect(hasAnyMacro(none)).toBe(false);
    expect(hasAnyMacro({ ...none, fat: 0 })).toBe(true);
    expect(hasAnyTarget(null)).toBe(false);
    expect(hasAnyTarget(none)).toBe(false);
    expect(hasAnyTarget({ ...none, calories: 2000 })).toBe(true);
  });
});

describe('dailyTotals', () => {
  it('adds each macro across meals, and notes which macros were logged at all', () => {
    const t = dailyTotals([
      { ...none, calories: 500, protein: 30.2 },
      { ...none, protein: 20.1, fat: 10 },
      none,
    ]);
    expect(t.calories).toBe(500);
    expect(t.protein).toBe(50.3);
    expect(t.carbs).toBe(0);
    expect(t.fat).toBe(10);
    expect(t.logged).toEqual({ calories: true, protein: true, carbs: false, fat: true });
    expect(t.mealCount).toBe(3);
  });
  it('is all zeros for no meals', () => {
    const t = dailyTotals([]);
    expect(MACRO_KEYS.map((k) => t[k])).toEqual([0, 0, 0, 0]);
    expect(t.mealCount).toBe(0);
  });
});

describe('macroProgress', () => {
  it('gives the share of the target, capped at 1 for the bar, and what is left', () => {
    expect(macroProgress(1500, 2000)).toEqual({ total: 1500, target: 2000, fraction: 0.75, over: false, remaining: 500 });
  });
  it('marks going over, with nothing remaining', () => {
    expect(macroProgress(2200, 2000)).toEqual({ total: 2200, target: 2000, fraction: 1, over: true, remaining: 0 });
  });
  it('has no fraction without a target (or a zero target)', () => {
    expect(macroProgress(80, null)).toEqual({ total: 80, target: null, fraction: null, over: false, remaining: null });
    expect(macroProgress(80, 0)).toEqual({ total: 80, target: 0, fraction: null, over: true, remaining: 0 });
  });
});

describe('formatMacro', () => {
  it('shows calories whole with grouping, grams to at most one decimal', () => {
    expect(formatMacro('calories', 1850.4)).toBe('1,850 kcal');
    expect(formatMacro('protein', 120)).toBe('120 g');
    expect(formatMacro('fat', 12.25)).toBe('12.3 g');
    expect(formatMacro('carbs', 1234.5)).toBe('1,234.5 g');
  });
});

describe('mealProblems', () => {
  const ok = { macros: { ...none, protein: 20 }, hasPhoto: false, name: '', note: '' };
  it('accepts a photo alone, macros alone, or both', () => {
    expect(mealProblems(ok)).toEqual([]);
    expect(mealProblems({ ...ok, macros: none, hasPhoto: true })).toEqual([]);
    expect(mealProblems({ ...ok, hasPhoto: true })).toEqual([]);
  });
  it('needs a photo or at least one macro (a note alone is not a meal)', () => {
    expect(mealProblems({ ...ok, macros: none, note: 'ate stuff' })).toEqual(['Add a photo or at least one of calories, protein, carbs or fat.']);
  });
  it('limits the name and note', () => {
    expect(mealProblems({ ...ok, name: 'x'.repeat(MEAL_NAME_MAX + 1) })).toEqual([`Keep the name to ${MEAL_NAME_MAX} characters.`]);
    expect(mealProblems({ ...ok, note: 'x'.repeat(MEAL_NOTE_MAX + 1) })).toEqual([`Keep the note to ${MEAL_NOTE_MAX} characters.`]);
  });
});

describe('mealPhotoPaths', () => {
  it('puts the photo in the client folder of the workspace, named by the meal', () => {
    expect(mealPhotoPaths('ws', 'me', 'meal', 'webp')).toEqual({ path: 'ws/me/meal.webp', thumbPath: 'ws/me/meal-thumb.webp' });
    expect(mealPhotoPaths('ws', 'me', 'meal', 'jpg').thumbPath).toBe('ws/me/meal-thumb.jpg');
  });
});

describe('foodDayLabel', () => {
  it('names today and yesterday, otherwise weekday, day and month', () => {
    expect(foodDayLabel('2026-11-07', '2026-11-07')).toBe('Today');
    expect(foodDayLabel('2026-11-06', '2026-11-07')).toBe('Yesterday');
    expect(foodDayLabel('2026-11-03', '2026-11-07')).toBe('Tue 3 Nov');
    expect(foodDayLabel('2025-12-31', '2026-11-07')).toBe('Wed 31 Dec 2025');
  });
});

describe('weekDays', () => {
  it('lists Monday to Sunday of the week holding the day', () => {
    expect(weekDays('2026-11-07')).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
  });
});

describe('mealsByDay', () => {
  it('groups meals by their day, earliest first within a day, and leaves empty days empty', () => {
    const a = { id: 'a', eatenOn: '2026-11-03', eatenAt: '2026-11-03T19:00:00Z' };
    const b = { id: 'b', eatenOn: '2026-11-03', eatenAt: '2026-11-03T08:00:00Z' };
    const c = { id: 'c', eatenOn: '2026-11-05', eatenAt: '2026-11-05T12:00:00Z' };
    const out = mealsByDay([a, c, b], ['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(out['2026-11-03']!.map((m) => m.id)).toEqual(['b', 'a']);
    expect(out['2026-11-04']).toEqual([]);
    expect(out['2026-11-05']!.map((m) => m.id)).toEqual(['c']);
  });
  it('ignores meals outside the days', () => {
    const out = mealsByDay([{ id: 'x', eatenOn: '2026-10-01', eatenAt: '2026-10-01T12:00:00Z' }], ['2026-11-03']);
    expect(out).toEqual({ '2026-11-03': [] });
  });
});

describe('formatMealTime', () => {
  it('shows a 12-hour time in the given time zone', () => {
    expect(formatMealTime('2026-11-05T08:10:00Z', 'UTC')).toBe('8:10 am');
    expect(formatMealTime('2026-11-05T00:05:00Z', 'UTC')).toBe('12:05 am');
    expect(formatMealTime('2026-11-05T13:30:00Z', 'UTC')).toBe('1:30 pm');
    expect(formatMealTime('2026-11-05T12:00:00Z', 'Pacific/Auckland')).toBe('1:00 am');
  });
});

describe('mealReference', () => {
  it('pre-fills a message about a named meal', () => {
    expect(mealReference({ name: 'Lunch', eatenOn: '2026-11-03', eatenAt: '2026-11-03T12:15:00Z' }, '2026-11-07', 'UTC')).toBe(
      'About your Lunch on Tue 3 Nov (12:15 pm): ',
    );
  });
  it('says "meal" when it has no name, and uses Today', () => {
    expect(mealReference({ name: null, eatenOn: '2026-11-07', eatenAt: '2026-11-07T19:00:00Z' }, '2026-11-07', 'UTC')).toBe(
      'About your meal today (7:00 pm): ',
    );
  });
});

describe('mealMacroLine', () => {
  it('lists only the entered macros, calories first', () => {
    expect(mealMacroLine({ calories: 650, protein: 42, carbs: null, fat: 12.5 })).toBe('650 kcal · P 42 g · F 12.5 g');
    expect(mealMacroLine({ calories: null, protein: null, carbs: 80, fat: null })).toBe('C 80 g');
    expect(mealMacroLine({ calories: null, protein: null, carbs: null, fat: null })).toBe('');
  });
});
