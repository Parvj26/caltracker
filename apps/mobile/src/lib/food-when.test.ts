import { describe, expect, it } from 'vitest';
import type { HistoryMeal } from '@caltracker/shared';
import { capWhen, copyItem, copyLabel, logAgainOp, logNowLabel, mealsToCopy, pickerDays, stepWhen, whenForMealType, whenFromParams, whenInstant, whenLabel, whenNow, whenParams } from './food-logic';

const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const TODAY = '2026-11-19';
const none = { calories: null, protein: null, carbs: null, fat: null };
const hist = (id: string, at: Date, over: Partial<HistoryMeal> = {}): HistoryMeal => ({
  id,
  eatenOn: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
  eatenAt: at.toISOString(),
  name: id,
  macros: { ...none, calories: 400 },
  hasPhoto: false,
  coachMealId: null,
  ...over,
});

describe('whenNow / whenInstant', () => {
  it('reads and writes the phone clock', () => {
    const w = whenNow(local(2026, 11, 19, 13, 15));
    expect(w).toEqual({ day: TODAY, minutes: 13 * 60 + 15 });
    expect(whenInstant(w).getTime()).toBe(local(2026, 11, 19, 13, 15).getTime());
  });
  it('puts 00:30 on the new day', () => {
    expect(whenNow(local(2026, 11, 20, 0, 30))).toEqual({ day: '2026-11-20', minutes: 30 });
  });
});

describe('whenForMealType', () => {
  const now = local(2026, 11, 19, 13, 15);
  it('sets the usual time on the picked day', () => {
    expect(whenForMealType('Breakfast', { day: TODAY, minutes: 795 }, now)).toEqual({ day: TODAY, minutes: 480 });
    expect(whenForMealType('Dinner', { day: '2026-11-17', minutes: 0 }, now)).toEqual({ day: '2026-11-17', minutes: 1140 });
  });
  it('never sets a time still to come today: it means the last one eaten', () => {
    expect(whenForMealType('Dinner', { day: TODAY, minutes: 795 }, now)).toEqual({ day: '2026-11-18', minutes: 1140 });
    expect(whenForMealType('Lunch', { day: TODAY, minutes: 795 }, now)).toEqual({ day: TODAY, minutes: 750 });
  });
  it('just after midnight, a meal still to come means the evening before', () => {
    const night = local(2026, 11, 20, 0, 30);
    expect(whenForMealType('Dinner', { day: '2026-11-20', minutes: 30 }, night)).toEqual({ day: TODAY, minutes: 1140 });
    expect(whenForMealType('Snack', { day: '2026-11-20', minutes: 30 }, night)).toEqual({ day: TODAY, minutes: 930 });
  });
});

describe('stepWhen', () => {
  it('moves by quarter hours', () => {
    expect(stepWhen({ day: TODAY, minutes: 793 }, 1, TODAY, '2026-11-13')).toEqual({ day: TODAY, minutes: 795 });
    expect(stepWhen({ day: TODAY, minutes: 793 }, -1, TODAY, '2026-11-13')).toEqual({ day: TODAY, minutes: 780 });
  });
  it('crosses midnight into the next or previous day', () => {
    expect(stepWhen({ day: '2026-11-18', minutes: 23 * 60 + 45 }, 1, TODAY, '2026-11-13')).toEqual({ day: TODAY, minutes: 0 });
    expect(stepWhen({ day: TODAY, minutes: 0 }, -1, TODAY, '2026-11-13')).toEqual({ day: '2026-11-18', minutes: 23 * 60 + 45 });
    expect(stepWhen({ day: TODAY, minutes: 10 }, -1, TODAY, '2026-11-13')).toEqual({ day: TODAY, minutes: 0 });
  });
  it('stops at the end of today and the start of the oldest day', () => {
    expect(stepWhen({ day: TODAY, minutes: 23 * 60 + 50 }, 1, TODAY, '2026-11-13')).toEqual({ day: TODAY, minutes: 23 * 60 + 59 });
    expect(stepWhen({ day: '2026-11-13', minutes: 0 }, -1, TODAY, '2026-11-13')).toEqual({ day: '2026-11-13', minutes: 0 });
  });
});

describe('labels', () => {
  it('names the meal from the time', () => {
    expect(whenLabel({ day: TODAY, minutes: 795 }, TODAY)).toBe('Lunch · Today, 1:15 PM');
    expect(whenLabel({ day: '2026-11-18', minutes: 30 }, TODAY)).toBe('Snack · Yesterday, 12:30 AM');
    expect(whenLabel({ day: '2026-11-16', minutes: 1140 }, TODAY)).toBe('Dinner · Mon 16 Nov, 7:00 PM');
  });
  it('copy says yesterday only when logging today', () => {
    expect(copyLabel({ day: TODAY, minutes: 795 }, TODAY)).toBe('Copy yesterday’s lunch');
    expect(copyLabel({ day: '2026-11-18', minutes: 480 }, TODAY)).toBe('Copy breakfast from the day before');
  });
  it('offers today and the six days before', () => {
    expect(pickerDays(TODAY)).toEqual(['2026-11-19', '2026-11-18', '2026-11-17', '2026-11-16', '2026-11-15', '2026-11-14', '2026-11-13']);
  });
});

describe('mealsToCopy', () => {
  const history = [
    hist('lunch-late', local(2026, 11, 18, 14, 0)),
    hist('lunch', local(2026, 11, 18, 12, 0)),
    hist('dinner', local(2026, 11, 18, 19, 0)),
    hist('blank', local(2026, 11, 18, 12, 30), { name: null, macros: none }),
    hist('today-lunch', local(2026, 11, 19, 12, 0)),
    hist('older-lunch', local(2026, 11, 17, 12, 0)),
  ];
  it('takes the day before’s meals of the same type, earliest first', () => {
    expect(mealsToCopy(history, { day: TODAY, minutes: 795 }).map((m) => m.id)).toEqual(['lunch', 'lunch-late']);
    expect(mealsToCopy(history, { day: TODAY, minutes: 1200 }).map((m) => m.id)).toEqual(['dinner']);
    expect(mealsToCopy(history, { day: TODAY, minutes: 480 })).toEqual([]);
  });
  it('logs a copy at the picked time without a photo, and an unnamed one stays unnamed', () => {
    const item = copyItem(hist('x', local(2026, 11, 18, 12, 0), { name: null, coachMealId: 'c1', hasPhoto: true }));
    const at = whenInstant({ day: TODAY, minutes: 795 });
    const op = logAgainOp(item, { opId: 'o', mealId: 'm', userId: 'u', workspaceId: 'w', now: at.toISOString() }, TODAY, at);
    expect(op.meal).toMatchObject({ name: null, eatenOn: TODAY, eatenAt: at.toISOString(), photo: null, coachMealId: 'c1', macros: { calories: 400 } });
  });
});

describe('whenParams / whenFromParams', () => {
  it('round-trips', () => {
    const w = { day: '2026-11-18', minutes: 30 };
    expect(whenFromParams(whenParams(w), TODAY)).toEqual(w);
  });
  it('refuses a future day or a bad time', () => {
    expect(whenFromParams({ day: '2026-11-20', minutes: '30' }, TODAY)).toBeNull();
    expect(whenFromParams({ day: TODAY, minutes: '1440' }, TODAY)).toBeNull();
    expect(whenFromParams({ day: TODAY }, TODAY)).toBeNull();
  });
});

describe('capWhen', () => {
  const now = local(2026, 11, 19, 13, 15);
  it('moves a time still to come back to now', () => {
    expect(capWhen({ day: TODAY, minutes: 1140 }, now)).toEqual({ day: TODAY, minutes: 795 });
  });
  it('keeps past times', () => {
    expect(capWhen({ day: TODAY, minutes: 600 }, now)).toEqual({ day: TODAY, minutes: 600 });
    expect(capWhen({ day: '2026-11-18', minutes: 1380 }, now)).toEqual({ day: '2026-11-18', minutes: 1380 });
  });
});

describe('logNowLabel', () => {
  it('says the meal type and the day', () => {
    expect(logNowLabel('Tuna wrap', { day: TODAY, minutes: 795 }, TODAY)).toBe('Log Tuna wrap for lunch today');
    expect(logNowLabel('Oats', { day: '2026-11-18', minutes: 480 }, TODAY)).toBe('Log Oats for breakfast yesterday');
    expect(logNowLabel('Pasta', { day: '2026-11-16', minutes: 1140 }, TODAY)).toBe('Log Pasta for dinner on Mon 16 Nov');
  });
});
