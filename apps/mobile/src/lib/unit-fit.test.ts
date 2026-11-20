import { describe, expect, it } from 'vitest';
import { insideNeed, numberBoxWidth, unitsInside } from './unit-fit';

const row = (...cells: Array<[string, string]>) => cells.map(([value, unit]) => ({ value, unit, weight: unit.startsWith('lb') }));

describe('unitsInside', () => {
  it('puts each-side units inside a phone-width box (SS3/SS4)', () => {
    expect(unitsInside(null, 90, row(['60', 'lb each'], ['12', 'reps each']), 1)).toBe(true);
    expect(unitsInside(null, 90, row(['20', 'lb'], ['12', 'reps']), 1)).toBe(true);
  });
  it('does not flip while typing 95 → 100 (room is kept for three digits)', () => {
    const before = unitsInside(null, 90, row(['95', 'lb each'], ['10', 'reps each']), 1);
    const after = unitsInside(before, 90, row(['100', 'lb each'], ['10', 'reps each']), 1);
    expect(before).toBe(true);
    expect(after).toBe(before);
    expect(insideNeed({ value: '95', unit: 'lb each', weight: true })).toBe(insideNeed({ value: '100', unit: 'lb each', weight: true }));
  });
  it('holds its choice within a few points either way (hysteresis)', () => {
    const cells = row(['100', 'reps each']);
    const need = insideNeed(cells[0]);
    expect(unitsInside(true, need - 3, cells, 1)).toBe(true);
    expect(unitsInside(false, need + 3, cells, 1)).toBe(false);
    expect(unitsInside(true, need - 5, cells, 1)).toBe(false);
    expect(unitsInside(false, need + 5, cells, 1)).toBe(true);
  });
  it('goes under the box for long numbers, large text, or before the box is measured', () => {
    expect(unitsInside(null, 90, row(['102.5', 'lb each']), 1)).toBe(false);
    expect(unitsInside(null, 200, row(['60', 'lb']), 1.3)).toBe(false);
    expect(unitsInside(null, 0, row(['60', 'lb']), 1)).toBe(false);
  });
  it('the number box never takes the unit’s room', () => {
    expect(numberBoxWidth({ value: '60', unit: 'lb each' }, 88)).toBeLessThanOrEqual(88 - 8 - 3 - 7 * 6);
  });
});
