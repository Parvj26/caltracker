import { describe, expect, it } from 'vitest';
import type { MealMacros } from '@caltracker/shared';
import { parseTargetsForm, validTimeZone, weekFromParam, weekRows } from './week';

describe('weekFromParam', () => {
  it('starts on the Monday of the given day, or of today', () => {
    expect(weekFromParam('2026-11-05', '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam(undefined, '2026-11-07')).toBe('2026-11-02');
  });
  it('ignores a malformed, impossible or future week', () => {
    expect(weekFromParam('nope', '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam('2026-02-31', '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam(['2026-10-01'], '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam('2026-11-20', '2026-11-07')).toBe('2026-11-02');
  });
});

describe('parseTargetsForm', () => {
  it('reads each target, blank as none', () => {
    expect(parseTargetsForm({ calories: '2000', protein: '150.5', carbs: '', fat: ' ' })).toEqual({
      ok: true,
      value: { calories: 2000, protein: 150.5, carbs: null, fat: null },
    });
  });
  it('reports every bad value', () => {
    expect(parseTargetsForm({ calories: 'x', protein: '2000', carbs: '', fat: '' })).toEqual({
      ok: false,
      errors: { calories: 'Enter calories as a number.', protein: 'Protein can be at most 1,000 g.' },
    });
  });
  it('treats missing fields as blank', () => {
    expect(parseTargetsForm({})).toEqual({ ok: true, value: { calories: null, protein: null, carbs: null, fat: null } });
  });
});

describe('validTimeZone', () => {
  it('accepts real zones and refuses anything else', () => {
    expect(validTimeZone('Pacific/Auckland')).toBe('Pacific/Auckland');
    expect(validTimeZone('UTC')).toBe('UTC');
    expect(validTimeZone('Mars/Olympus')).toBeNull();
    expect(validTimeZone('')).toBeNull();
    expect(validTimeZone(undefined)).toBeNull();
    expect(validTimeZone('x'.repeat(65))).toBeNull();
  });
});

describe('weekRows', () => {
  const meal = (calories: number | null): { macros: MealMacros } => ({ macros: { calories, protein: 10, carbs: null, fat: null } });
  const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'] as const;
  const byDay = {
    '2026-11-09': [meal(1000), meal(980)],
    '2026-11-10': [meal(2240)],
    '2026-11-11': [],
    '2026-11-12': [meal(null)],
    '2026-11-13': [meal(1240)],
    '2026-11-14': [],
    '2026-11-15': [],
  };

  it('gives each day Monday to Sunday its calories, bar and meal count, marking today', () => {
    const rows = weekRows([...days], byDay, '2026-11-13', 2100);
    expect(rows.map((r) => r.day)).toEqual([...days]);
    expect(rows[0]).toEqual({ day: '2026-11-09', isToday: false, state: 'meals', calories: 1980, mealCount: 2, fraction: 1980 / 2100, over: null });
    expect(rows[4]).toMatchObject({ isToday: true, state: 'meals', calories: 1240, mealCount: 1 });
  });

  it('says how far over the calorie target a day went', () => {
    expect(weekRows([...days], byDay, '2026-11-13', 2100)[1]).toMatchObject({ fraction: 1, over: '140 over' });
  });

  it('tells empty past days from days still to come', () => {
    const rows = weekRows([...days], byDay, '2026-11-13', 2100);
    expect(rows[2]!.state).toBe('empty');
    expect(rows[5]!.state).toBe('future');
    expect(rows[6]!.state).toBe('future');
  });

  it('counts a meal without calories, and has no bar without a target', () => {
    const rows = weekRows([...days], byDay, '2026-11-13', null);
    expect(rows[3]).toMatchObject({ state: 'meals', calories: 0, mealCount: 1, fraction: null, over: null });
    expect(rows[0]!.fraction).toBeNull();
  });
});
