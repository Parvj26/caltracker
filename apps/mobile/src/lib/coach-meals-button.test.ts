import { describe, expect, it } from 'vitest';
import { coachMealsButton } from './coach-meals-button';

describe('coachMealsButton', () => {
  it('names the coach and counts the live meals', () => {
    expect(coachMealsButton(12, 'Luis')).toEqual({ label: 'Meals from Luis', badge: '12', accessibilityLabel: 'Meals from Luis, 12 meals' });
  });
  it('says "1 meal" for one', () => {
    expect(coachMealsButton(1, 'Luis')?.accessibilityLabel).toBe('Meals from Luis, 1 meal');
  });
  it('falls back without a name', () => {
    expect(coachMealsButton(3, null)).toEqual({ label: 'Meals from your coach', badge: '3', accessibilityLabel: 'Meals from your coach, 3 meals' });
  });
  it('is hidden when the coach shared no meals', () => {
    expect(coachMealsButton(0, 'Luis')).toBeNull();
  });
  it('caps a big count in the badge', () => {
    expect(coachMealsButton(150, 'Luis')?.badge).toBe('99+');
  });
});
