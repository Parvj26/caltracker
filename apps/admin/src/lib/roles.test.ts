import { describe, expect, it } from 'vitest';
import { isProductionEnv, roleAtLeast } from './roles';

describe('roleAtLeast', () => {
  it('orders owner > support > readonly', () => {
    expect(roleAtLeast('owner', 'owner')).toBe(true);
    expect(roleAtLeast('owner', 'readonly')).toBe(true);
    expect(roleAtLeast('support', 'readonly')).toBe(true);
    expect(roleAtLeast('support', 'owner')).toBe(false);
    expect(roleAtLeast('readonly', 'support')).toBe(false);
    expect(roleAtLeast('readonly', 'readonly')).toBe(true);
  });
});

describe('isProductionEnv', () => {
  it('is production only for exactly "production"', () => {
    expect(isProductionEnv('production')).toBe(true);
    expect(isProductionEnv('staging')).toBe(false);
    expect(isProductionEnv('')).toBe(false);
    expect(isProductionEnv(undefined)).toBe(false);
  });
});
