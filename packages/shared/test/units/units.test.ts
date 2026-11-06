import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDistance,
  formatDuration,
  formatWeight,
  fromKg,
  fromMeters,
  kgToInput,
  parseClock,
  toKg,
  toMeters,
} from '../../src/units/units';

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

describe('fromMeters', () => {
  it('converts metres to km or miles, rounded to 2 decimals', () => {
    expect(fromMeters(2500, 'km')).toBe(2.5);
    expect(fromMeters(1609.34, 'mi')).toBe(1);
    expect(fromMeters(5000, 'mi')).toBe(3.11);
  });
  it('round trips what toMeters stored', () => {
    for (const v of [0.01, 0.5, 1, 3.1, 10, 42.2]) {
      expect(fromMeters(toMeters(v, 'km'), 'km')).toBe(v);
      expect(fromMeters(toMeters(v, 'mi'), 'mi')).toBe(v);
    }
  });
});

describe('clock durations', () => {
  it('formats seconds as m:ss or h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(45)).toBe('0:45');
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(3725)).toBe('1:02:05');
  });
  it('parses plain seconds, m:ss and h:mm:ss', () => {
    expect(parseClock('90')).toBe(90);
    expect(parseClock(' 1:30 ')).toBe(90);
    expect(parseClock('0:45')).toBe(45);
    expect(parseClock('1:02:05')).toBe(3725);
    expect(parseClock('2:')).toBe(120);
  });
  it('returns null for blank text and NaN for text it cannot read', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('  ')).toBeNull();
    expect(parseClock('abc')).toBeNaN();
    expect(parseClock('1:75')).toBeNaN();
    expect(parseClock('-5')).toBeNaN();
    expect(parseClock('1.5')).toBeNaN();
  });
});

describe('pounds are whole numbers', () => {
  it('rounds converted pounds to the nearest whole pound', () => {
    expect(fromKg(60, 'lb')).toBe(132);
    expect(fromKg(61.235, 'lb')).toBe(135);
    expect(fromKg(0, 'lb')).toBe(0);
    expect(fromKg(22.68, 'lb')).toBe(50);
  });
  it('keeps a typed half pound and rounds anything else to a whole pound', () => {
    expect(fromKg(toKg(132.5, 'lb'), 'lb')).toBe(132.5);
    expect(fromKg(toKg(132.4, 'lb'), 'lb')).toBe(132);
    expect(fromKg(toKg(132.6, 'lb'), 'lb')).toBe(133);
  });
  it('formats pounds without decimals', () => {
    expect(formatWeight(60, 'lb')).toBe('132 lb');
    expect(formatWeight(0, 'lb')).toBe('0 lb');
  });
  it('still saves a typed half pound exactly', () => {
    expect(toKg(132.5, 'lb')).toBe(60.101);
  });
});

describe('kgToInput', () => {
  it('shows a kg coach the kilograms they typed, to 3 decimals', () => {
    expect(kgToInput(61.25, 'kg')).toBe(61.25);
    expect(kgToInput(60, 'kg')).toBe(60);
    expect(kgToInput(61.2345, 'kg')).toBe(61.235);
  });
  it('shows a lb coach whole pounds, so 135 lb stays 135', () => {
    expect(kgToInput(61.235, 'lb')).toBe(135);
    expect(kgToInput(60, 'lb')).toBe(132);
    expect(kgToInput(0, 'lb')).toBe(0);
  });
});

describe('half pounds', () => {
  it('round trips a typed half pound', () => {
    expect(fromKg(toKg(102.5, 'lb'), 'lb')).toBe(102.5);
    expect(kgToInput(toKg(102.5, 'lb'), 'lb')).toBe(102.5);
    expect(formatWeight(toKg(102.5, 'lb'), 'lb')).toBe('102.5 lb');
    expect(kgToInput(46.4927, 'lb')).toBe(102.5);
    expect(formatWeight(toKg(132.5, 'lb'), 'lb')).toBe('132.5 lb');
    expect(fromKg(toKg(0.5, 'lb'), 'lb')).toBe(0.5);
    expect(formatWeight(toKg(0.5, 'lb'), 'lb')).toBe('0.5 lb');
  });
  it('round trips every half pound from 0.5 to 999.5', () => {
    for (let lb = 0.5; lb < 1000; lb += 1) expect(fromKg(toKg(lb, 'lb'), 'lb')).toBe(lb);
  });
  it('still hides conversions that only land near a half pound', () => {
    expect(fromKg(60, 'lb')).toBe(132);
    expect(formatWeight(60, 'lb')).toBe('132 lb');
    expect(fromKg(100, 'lb')).toBe(220);
    expect(kgToInput(100, 'lb')).toBe(220);
    expect(kgToInput(60.2, 'lb')).toBe(133); // 132.72 lb
    expect(formatWeight(22.68, 'lb')).toBe('50 lb'); // 50.0007 lb
  });
  it('leaves kilograms as they were', () => {
    expect(fromKg(60.101, 'kg')).toBe(60.1);
    expect(kgToInput(60.101, 'kg')).toBe(60.101);
    expect(formatWeight(46.493, 'kg')).toBe('46.5 kg');
  });
});
