import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatWeight, fromKg, toKg, toMeters } from '../../src/units/units';

describe('weight', () => {
  it('converts 135 lb to 61.235 kg and back', () => {
    expect(toKg(135, 'lb')).toBe(61.235);
    expect(fromKg(toKg(135, 'lb'), 'lb')).toBe(135);
  });
  it('round trips every whole pound from 1 to 1000', () => {
    for (let lb = 1; lb <= 1000; lb++) expect(fromKg(toKg(lb, 'lb'), 'lb')).toBe(lb);
  });
  it('round trips every half kilo from 0.5 to 500', () => {
    for (let kg = 0.5; kg <= 500; kg += 0.5) expect(fromKg(toKg(kg, 'kg'), 'kg')).toBe(kg);
  });
  it('formats weights, dropping a trailing .0', () => {
    expect(formatWeight(61.235, 'kg')).toBe('61.2 kg');
    expect(formatWeight(60, 'kg')).toBe('60 kg');
    expect(formatWeight(toKg(135, 'lb'), 'lb')).toBe('135 lb');
  });
});

describe('distance', () => {
  it('converts to metres', () => {
    expect(toMeters(5, 'km')).toBe(5000);
    expect(toMeters(1, 'mi')).toBe(1609.34);
  });
  it('formats distances by unit system', () => {
    expect(formatDistance(5000, 'lb')).toBe('3.11 mi');
    expect(formatDistance(5000, 'kg')).toBe('5 km');
    expect(formatDistance(400, 'kg')).toBe('400 m');
    expect(formatDistance(1500, 'kg')).toBe('1.5 km');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(3600)).toBe('1:00:00');
  });
});
