import { describe, expect, it } from 'vitest';
import { clockTime, initialsOf } from './chat-format';

describe('initialsOf', () => {
  it('uses the first and last name', () => {
    expect(initialsOf('Sam Rivera')).toBe('SR');
    expect(initialsOf('Ana Maria Lopez')).toBe('AL');
  });
  it('uses one letter for one name, and C when there is no name', () => {
    expect(initialsOf('sam')).toBe('S');
    expect(initialsOf(null)).toBe('C');
    expect(initialsOf('  ')).toBe('C');
  });
});

describe('clockTime', () => {
  it('writes 12-hour times in the given zone without relying on locale data', () => {
    expect(clockTime('2026-11-05T14:05:00.000Z', 'UTC')).toBe('2:05 pm');
    expect(clockTime('2026-11-05T00:30:00.000Z', 'UTC')).toBe('12:30 am');
    expect(clockTime('2026-11-05T12:00:00.000Z', 'UTC')).toBe('12:00 pm');
    expect(clockTime('2026-11-05T14:05:00.000Z', 'Pacific/Auckland')).toBe('3:05 am');
  });
});
