import { describe, expect, it } from 'vitest';
import { typedToStored } from './stepper-input';

describe('typedToStored', () => {
  it('turns typed pounds into kilograms', () => {
    expect(typedToStored('weight', 'lb', '135')).toBeCloseTo(61.235, 2);
  });
  it('keeps typed kilograms as they are', () => {
    expect(typedToStored('weight', 'kg', '60')).toBe(60);
  });
  it('turns typed miles into metres', () => {
    expect(typedToStored('distance', 'mi', '1')).toBeCloseTo(1609.344, 2);
  });
  it('reads reps and m:ss as typed', () => {
    expect(typedToStored('reps', 'reps', '8')).toBe(8);
    expect(typedToStored('duration', 'm:ss', '1:30')).toBe(90);
  });
  it('treats empty as cleared', () => {
    expect(typedToStored('weight', 'lb', '')).toBeNull();
  });
  it('ignores text that is not a number or is over the limit', () => {
    expect(typedToStored('reps', 'reps', 'abc')).toBeUndefined();
    expect(typedToStored('weight', 'kg', '1500')).toBeUndefined();
    expect(typedToStored('distance', 'km', '5000')).toBeUndefined();
  });
});
