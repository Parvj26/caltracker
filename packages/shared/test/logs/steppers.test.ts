import { describe, expect, it } from 'vitest';
import { stepSetValue } from '../../src/logs/steppers';
import { fromMeters, toKg, toMeters } from '../../src/units/units';

describe('stepSetValue', () => {
  it('lb steps on whole pounds', () => {
    expect(stepSetValue('weight', 61.235, 1, 'lb')).toBe(toKg(140, 'lb'));
    const up = stepSetValue('weight', toKg(137, 'lb'), 1, 'lb');
    expect(up).toBe(toKg(142, 'lb'));
    expect(stepSetValue('weight', up, -1, 'lb')).toBe(toKg(137, 'lb'));
  });

  it('kg steps by 2.5, floors at 0 and refuses to pass the cap', () => {
    expect(stepSetValue('weight', 61.25, 1, 'kg')).toBe(63.75);
    expect(stepSetValue('weight', 1, -1, 'kg')).toBe(0);
    expect(stepSetValue('weight', 999, 1, 'kg')).toBe(999);
  });

  it('starts from empty', () => {
    expect(stepSetValue('weight', null, 1, 'lb')).toBe(toKg(5, 'lb'));
    expect(stepSetValue('weight', null, -1, 'lb')).toBeNull();
    expect(stepSetValue('reps', null, 1, 'kg')).toBe(1);
    expect(stepSetValue('reps', 0, -1, 'kg')).toBe(0);
  });

  it('steps duration by 15 s and distance by 0.1 of the unit', () => {
    expect(stepSetValue('duration', 30, -1, 'kg')).toBe(15);
    expect(stepSetValue('duration', 15, -1, 'kg')).toBe(0);
    const m = toMeters(1.5, 'mi');
    expect(stepSetValue('distance', m, 1, 'lb')).toBe(toMeters(1.6, 'mi'));
    expect(fromMeters(stepSetValue('distance', m, -1, 'lb') as number, 'mi')).toBe(1.4);
    expect(stepSetValue('distance', null, 1, 'kg')).toBe(toMeters(0.1, 'km'));
  });
});
