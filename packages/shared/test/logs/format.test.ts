import { describe, expect, it } from 'vitest';
import { formatLastResult, formatLogDuration, formatLogSetTarget, formatLogVolume } from '../../src/logs/format';
import type { LogSetTarget } from '../../src/logs/schema';
import { toKg } from '../../src/units/units';

const target = (over: Partial<LogSetTarget> = {}): LogSetTarget => ({
  repsMin: 8,
  repsMax: 10,
  weightKg: toKg(135, 'lb'),
  durationS: null,
  distanceM: null,
  toFailure: false,
  restSeconds: 90,
  ...over,
});

const done = (over: Record<string, unknown> = {}) => ({
  setType: 'normal' as const,
  actualReps: 8,
  actualWeightKg: toKg(135, 'lb'),
  actualDurationS: null,
  actualDistanceM: null,
  ...over,
});

describe('formatLogSetTarget', () => {
  it('reads like the planned target, in the viewer units', () => {
    expect(formatLogSetTarget(target(), 'weight_reps', 'lb')).toBe('8–10 reps · 135 lb');
    expect(formatLogSetTarget(target({ repsMin: 8, repsMax: 8 }), 'reps', 'lb')).toBe('8 reps');
    expect(formatLogSetTarget(target({ toFailure: true }), 'weight_reps', 'kg')).toBe('To failure');
    expect(formatLogSetTarget(target({ repsMin: null, repsMax: null, weightKg: null }), 'weight_reps', 'kg')).toBe('—');
    expect(formatLogSetTarget(target({ durationS: 90 }), 'time', 'kg')).toBe('1:30');
  });
});

describe('formatLastResult', () => {
  it('uses the first non-warm-up set: "Last time: 135 lb × 8"', () => {
    const sets = [done({ setType: 'warmup', actualReps: 12, actualWeightKg: 20 }), done(), done({ actualReps: 6 })];
    expect(formatLastResult(sets, 'weight_reps', 'lb')).toBe('Last time: 135 lb × 8');
  });

  it('shows kg to kg viewers', () => {
    expect(formatLastResult([done({ actualWeightKg: 60 })], 'weight_reps', 'kg')).toBe('Last time: 60 kg × 8');
  });

  it('falls back to what was recorded when weight or reps is missing', () => {
    expect(formatLastResult([done({ actualWeightKg: null })], 'weight_reps', 'lb')).toBe('Last time: 8 reps');
    expect(formatLastResult([done({ actualReps: null })], 'weight_reps', 'lb')).toBe('Last time: 135 lb');
    expect(formatLastResult([done({ actualReps: 1 })], 'reps', 'lb')).toBe('Last time: 1 rep');
  });

  it('formats time and distance exercises', () => {
    expect(formatLastResult([done({ actualDurationS: 90 })], 'time', 'kg')).toBe('Last time: 1:30');
    expect(formatLastResult([done({ actualDistanceM: 5000 })], 'distance', 'kg')).toBe('Last time: 5 km');
  });

  it('is null with nothing to show: no sets, only warm-ups, or no values', () => {
    expect(formatLastResult([], 'weight_reps', 'lb')).toBeNull();
    expect(formatLastResult([done({ setType: 'warmup' })], 'weight_reps', 'lb')).toBeNull();
    expect(formatLastResult([done({ actualReps: null, actualWeightKg: null })], 'weight_reps', 'lb')).toBeNull();
  });
});

describe('formatLogDuration', () => {
  it('reads as minutes, then hours and minutes', () => {
    expect(formatLogDuration(0)).toBe('1 min');
    expect(formatLogDuration(29)).toBe('1 min');
    expect(formatLogDuration(52 * 60 + 40)).toBe('53 min');
    expect(formatLogDuration(60 * 60)).toBe('1 h');
    expect(formatLogDuration(65 * 60)).toBe('1 h 5 min');
    expect(formatLogDuration(2 * 3600 + 59 * 60 + 50)).toBe('3 h');
  });
});

describe('formatLogVolume', () => {
  it('converts to the client units and groups thousands: "8,420 lb lifted"', () => {
    expect(formatLogVolume(toKg(8420, 'lb'), 'lb')).toBe('8,420 lb lifted');
    expect(formatLogVolume(1440, 'lb')).toBe('3,174.7 lb lifted');
    expect(formatLogVolume(1440, 'kg')).toBe('1,440 kg lifted');
    expect(formatLogVolume(1234567.5, 'kg')).toBe('1,234,567.5 kg lifted');
  });

  it('keeps small totals as they are', () => {
    expect(formatLogVolume(0, 'kg')).toBe('0 kg lifted');
    expect(formatLogVolume(960.4, 'kg')).toBe('960.4 kg lifted');
  });
});
