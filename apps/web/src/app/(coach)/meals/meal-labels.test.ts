import { describe, expect, it } from 'vitest';
import { loggedLabel, mealInitial } from './meal-labels';

describe('loggedLabel', () => {
  it('says "Not logged yet" before any client logs the meal', () => {
    expect(loggedLabel(0)).toBe('Not logged yet');
  });
  it('counts one log as "1 time" and more as "times"', () => {
    expect(loggedLabel(1)).toBe('Logged 1 time');
    expect(loggedLabel(12)).toBe('Logged 12 times');
  });
  it('treats a bad count as none', () => {
    expect(loggedLabel(-1)).toBe('Not logged yet');
    expect(loggedLabel(Number.NaN)).toBe('Not logged yet');
  });
});

describe('mealInitial', () => {
  it('is the first letter, upper case', () => {
    expect(mealInitial('turkey wrap')).toBe('T');
    expect(mealInitial('Éclair')).toBe('É');
  });
  it('skips leading spaces and symbols', () => {
    expect(mealInitial('  "protein" oats')).toBe('P');
    expect(mealInitial('🍳 eggs')).toBe('E');
  });
  it('can be a digit', () => {
    expect(mealInitial('3 egg omelette')).toBe('3');
  });
  it('falls back to "?" when there is no letter', () => {
    expect(mealInitial('')).toBe('?');
    expect(mealInitial('🍳')).toBe('?');
  });
});
