import { describe, expect, it } from 'vitest';
import {
  coachLine,
  formatLastResult,
  formatLogDuration,
  formatLogSetTarget,
  formatLogVolume,
  formatResult,
  planSummary,
  stepName,
} from '../../src/logs/format';
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
    expect(formatLogSetTarget(target({ toFailure: true }), 'weight_reps', 'lb')).toBe('135 lb × to failure');
    expect(formatLogSetTarget(target({ toFailure: true, weightKg: null }), 'weight_reps', 'kg')).toBe('To failure');
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

  it('formats weight-and-time exercises, ignoring reps', () => {
    expect(formatLastResult([done({ actualWeightKg: toKg(70, 'lb'), actualDurationS: 60 })], 'weight_time', 'lb')).toBe(
      'Last time: 70 lb · 1:00',
    );
    expect(formatLastResult([done({ actualWeightKg: null, actualDurationS: 45 })], 'weight_time', 'lb')).toBe('Last time: 45 s');
    expect(formatLastResult([done({ actualWeightKg: 32 })], 'weight_time', 'kg')).toBe('Last time: 32 kg');
    expect(formatLastResult([done({ actualWeightKg: null })], 'weight_time', 'kg')).toBeNull();
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
  it('converts to the client units, rounds to whole units once and groups thousands', () => {
    expect(formatLogVolume(toKg(8420, 'lb'), 'lb')).toBe('8,420 lb lifted');
    expect(formatLogVolume(1440, 'lb')).toBe('3,175 lb lifted');
    expect(formatLogVolume(1440, 'kg')).toBe('1,440 kg lifted');
    expect(formatLogVolume(1234567.5, 'kg')).toBe('1,234,568 kg lifted');
  });

  it('keeps small totals whole', () => {
    expect(formatLogVolume(0, 'kg')).toBe('0 kg lifted');
    expect(formatLogVolume(960.4, 'kg')).toBe('960 kg lifted');
  });

  it('rounds from the unrounded conversion, not per set', () => {
    expect(formatLogVolume(toKg(135, 'lb') * 24, 'lb')).toBe('3,240 lb lifted');
  });
});

const logSet = (setType: 'normal' | 'warmup' | 'drop', over: Partial<LogSetTarget> = {}) => ({
  setType,
  target: target({ repsMin: 8, repsMax: 10, weightKg: 60, ...over }),
});
// The helpers only read setType and target, so a thin shape is enough here.
const ex = (sets: ReturnType<typeof logSet>[], trackingType: 'weight_reps' | 'reps' = 'weight_reps') =>
  ({ sets, trackingType }) as unknown as Parameters<typeof planSummary>[0];

describe('formatResult', () => {
  it('words a set the way the last-time line does', () => {
    const v = { reps: 8, weightKg: 61.235, durationS: null, distanceM: null };
    expect(formatResult(v, 'weight_reps', 'lb')).toBe('135 lb × 8');
    expect(formatResult({ ...v, weightKg: null }, 'weight_reps', 'lb')).toBe('8 reps');
    expect(formatResult({ reps: null, weightKg: null, durationS: null, distanceM: null }, 'weight_reps', 'lb')).toBeNull();
  });
});

describe('stepName', () => {
  const e = ex([logSet('warmup'), logSet('warmup'), logSet('normal'), logSet('normal'), logSet('normal'), logSet('drop'), logSet('drop')]);
  it('counts warm-ups, working sets and drops separately', () => {
    expect(stepName(e, 1)).toBe('Warm-up 2 of 2');
    expect(stepName(e, 4)).toBe('Set 3 of 3');
    expect(stepName(e, 6)).toBe('Drop 2 of 2');
  });
  it('counts drops only within their own group', () => {
    const g = ex([logSet('normal'), logSet('drop'), logSet('normal'), logSet('drop'), logSet('drop')]);
    expect(stepName(g, 1)).toBe('Drop 1 of 1');
    expect(stepName(g, 4)).toBe('Drop 2 of 2');
  });
});

describe('planSummary and coachLine', () => {
  it('summarises uniform working sets', () => {
    expect(planSummary(ex([logSet('warmup'), logSet('normal'), logSet('normal'), logSet('normal')]), 'kg')).toBe('3 × 8–10 reps · 60 kg');
  });
  it('falls back to a count when targets differ or are empty', () => {
    const pyramid = ex([logSet('normal'), logSet('normal', { weightKg: 70, repsMin: 8, repsMax: 8 })]);
    expect(planSummary(pyramid, 'kg')).toBe('2 sets');
    expect(planSummary(ex([logSet('normal', { repsMin: null, repsMax: null, weightKg: null })]), 'kg')).toBe('1 set');
  });
  it('words a to-failure plan', () => {
    const f = { repsMin: null, repsMax: null, toFailure: true };
    const none = { ...f, weightKg: null };
    expect(planSummary(ex([logSet('normal', none), logSet('normal', none), logSet('normal', none)]), 'kg')).toBe('3 × To failure');
    expect(planSummary(ex([logSet('normal', f), logSet('normal', f)]), 'kg')).toBe('2 × 60 kg × to failure');
  });
  it('is null when there are no working sets', () => {
    expect(planSummary(ex([logSet('warmup'), logSet('drop')]), 'kg')).toBeNull();
  });
  it('shows the plan on working sets and the own target otherwise', () => {
    const uniform = ex([logSet('warmup', { weightKg: 20 }), logSet('normal'), logSet('normal')]);
    expect(coachLine(uniform, 1, 'kg')).toBe('Coach: 2 × 8–10 reps · 60 kg');
    expect(coachLine(uniform, 0, 'kg')).toBe('Coach: 8–10 reps · 20 kg');
    const pyramid = ex([logSet('normal'), logSet('normal', { weightKg: 70, repsMin: 8, repsMax: 8 })]);
    expect(coachLine(pyramid, 1, 'kg')).toBe('Coach: 8 reps · 70 kg');
  });
  it('is null with nothing to show', () => {
    const empty = { repsMin: null, repsMax: null, weightKg: null };
    expect(coachLine(ex([logSet('normal', empty), logSet('normal', empty)]), 0, 'kg')).toBeNull();
  });
});
