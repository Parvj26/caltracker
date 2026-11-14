import { describe, expect, it } from 'vitest';
import {
  QUICK_REPS,
  REST_PRESETS,
  applyToAllPatches,
  setLineParts,
  stepRepsFrom,
  stepSource,
  stepWeightFrom,
} from '../../src/workouts/set-editor';
import type { WorkoutSetDoc } from '../../src/workouts/schema';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const LB = 0.45359237;
const set = (over: Partial<WorkoutSetDoc> = {}): WorkoutSetDoc => ({
  id: id(),
  setType: 'normal',
  targetRepsMin: 12,
  targetRepsMax: 12,
  targetWeightKg: 10,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 90,
  note: null,
  ...over,
});
const blank = (over: Partial<WorkoutSetDoc> = {}) =>
  set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, ...over });

describe('presets', () => {
  it('offers the quick rep chips 8 · 10 · 12 · 15 and rest presets', () => {
    expect(QUICK_REPS).toEqual([8, 10, 12, 15]);
    expect(REST_PRESETS).toEqual([60, 90, 120, 180]);
  });
});

describe('setLineParts', () => {
  it('reads reps × weight and the rest', () => {
    expect(setLineParts(set(), 'weight_reps', 'kg', { showsRest: true })).toEqual({ values: '12 × 10 kg', rest: 'rest 1:30' });
  });
  it('uses the coach’s units', () => {
    expect(setLineParts(set({ targetWeightKg: 135 * LB }), 'weight_reps', 'lb', { showsRest: true }).values).toBe('12 × 135 lb');
  });
  it('says nothing for a blank set, so the line can say "Not filled yet"', () => {
    expect(setLineParts(blank(), 'weight_reps', 'kg', { showsRest: true })).toEqual({ values: null, rest: 'rest 1:30' });
  });
  it('a drop, a 0 rest or a superset exercise that runs straight on has no rest', () => {
    expect(setLineParts(set({ setType: 'drop', targetWeightKg: 7.5 }), 'weight_reps', 'kg', { showsRest: true })).toEqual({
      values: '12 × 7.5 kg',
      rest: 'no rest',
    });
    expect(setLineParts(set({ restSeconds: 0 }), 'weight_reps', 'kg', { showsRest: true }).rest).toBe('no rest');
    expect(setLineParts(set(), 'weight_reps', 'kg', { showsRest: false }).rest).toBe('no rest');
  });
  it('reads half-filled weight and reps sets', () => {
    expect(setLineParts(set({ targetWeightKg: null }), 'weight_reps', 'kg', { showsRest: true }).values).toBe('12 reps');
    expect(setLineParts(set({ targetRepsMin: null, targetRepsMax: null }), 'weight_reps', 'kg', { showsRest: true }).values).toBe('10 kg');
  });
  it('reads a set to failure with no rep count as max', () => {
    expect(setLineParts(set({ toFailure: true, targetRepsMin: null, targetRepsMax: null }), 'weight_reps', 'kg', { showsRest: true }).values).toBe('max × 10 kg');
    expect(setLineParts(blank({ toFailure: true }), 'reps', 'kg', { showsRest: true }).values).toBe('max reps');
  });
  it('reads the other tracking types', () => {
    const opts = { showsRest: true };
    expect(setLineParts(set(), 'reps', 'kg', opts).values).toBe('12 reps');
    expect(setLineParts(set(), 'weight', 'kg', opts).values).toBe('10 kg');
    expect(setLineParts(set({ targetDurationS: 45 }), 'time', 'kg', opts).values).toBe('0:45');
    expect(setLineParts(set({ targetDistanceM: 400 }), 'distance', 'kg', opts).values).toBe('400 m');
    expect(setLineParts(set({ targetDistanceM: 1609.344 }), 'distance', 'lb', opts).values).toBe('1 mi');
    expect(setLineParts(set({ targetDurationS: 30 }), 'weight_time', 'kg', opts).values).toBe('10 kg · 0:30');
    expect(setLineParts(set({ targetDurationS: 30 }), 'reps_time', 'kg', opts).values).toBe('12 reps · 0:30');
    expect(setLineParts(set({ targetDurationS: 30 }), 'weight_reps_time', 'kg', opts).values).toBe('12 × 10 kg · 0:30');
    expect(setLineParts(set(), 'time', 'kg', opts).values).toBeNull();
  });
});

describe('stepRepsFrom', () => {
  it('steps a filled box by one', () => {
    const sets = [set(), set()];
    expect(stepRepsFrom(sets, 1, 1)).toBe(13);
    expect(stepRepsFrom(sets, 1, -1)).toBe(11);
  });
  it('a blank box starts from the previous set’s reps, not from 1', () => {
    const sets = [set({ targetRepsMin: 12, targetRepsMax: 12 }), blank()];
    expect(stepRepsFrom(sets, 1, 1)).toBe(12);
    expect(stepRepsFrom(sets, 1, -1)).toBe(12);
  });
  it('skips blank sets back to the nearest filled one, then looks forward', () => {
    expect(stepRepsFrom([set({ targetRepsMin: 8, targetRepsMax: 8 }), blank(), blank()], 2, 1)).toBe(8);
    expect(stepRepsFrom([blank(), set({ targetRepsMin: 15, targetRepsMax: 15 })], 0, 1)).toBe(15);
  });
  it('with nothing to copy, + starts at 10 and − stays empty', () => {
    expect(stepRepsFrom([blank(), blank()], 1, 1)).toBe(10);
    expect(stepRepsFrom([blank()], 0, -1)).toBeNull();
  });
});

describe('stepWeightFrom', () => {
  it('steps a filled box to the next plate', () => {
    expect(stepWeightFrom([set({ targetWeightKg: 10 })], 0, 1, 'kg')).toBe(12.5);
    expect(stepWeightFrom([set({ targetWeightKg: 10 })], 0, -1, 'kg')).toBe(7.5);
  });
  it('a blank box starts from the previous set’s weight, not from 2.5 kg', () => {
    const sets = [set({ targetWeightKg: 20 }), blank()];
    expect(stepWeightFrom(sets, 1, 1, 'kg')).toBe(20);
    expect(stepWeightFrom(sets, 1, -1, 'kg')).toBe(20);
  });
  it('with nothing to copy, + gives one step in the coach’s units', () => {
    expect(stepWeightFrom([blank()], 0, 1, 'kg')).toBe(2.5);
    expect(stepWeightFrom([blank()], 0, 1, 'lb')).toBeCloseTo(5 * LB, 3);
    expect(stepWeightFrom([blank()], 0, -1, 'kg')).toBeNull();
  });
});

describe('stepSource', () => {
  it('names the set a blank box would start from', () => {
    const sets = [set(), blank(), blank()];
    expect(stepSource(sets, 2, ['reps', 'weight'])).toBe(0);
    expect(stepSource(sets, 0, ['reps', 'weight'])).toBeNull();
    expect(stepSource([blank(), blank()], 1, ['reps'])).toBeNull();
  });
});

describe('applyToAllPatches', () => {
  it('copies the targets and rest of one set to every other set that differs', () => {
    const a = set({ targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 10, restSeconds: 90 });
    const b = blank({ restSeconds: 60 });
    const c = set({ targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 10, restSeconds: 90 });
    expect(applyToAllPatches([a, b, c], 0, [true, true, true])).toEqual([
      {
        id: b.id,
        patch: { targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 10, targetDurationS: null, targetDistanceM: null, restSeconds: 90 },
      },
    ]);
  });
  it('keeps each set’s type, and leaves the rest alone on drops and sets that show none', () => {
    const a = set({ targetWeightKg: 20, restSeconds: 120 });
    const drop = set({ setType: 'drop', targetWeightKg: 7.5, restSeconds: 0 });
    const warm = set({ setType: 'warmup', targetWeightKg: 5, restSeconds: 60 });
    const patches = applyToAllPatches([a, drop, warm], 0, [true, true, false]);
    expect(patches).toEqual([
      { id: drop.id, patch: { targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 20, targetDurationS: null, targetDistanceM: null } },
      { id: warm.id, patch: { targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 20, targetDurationS: null, targetDistanceM: null } },
    ]);
    for (const p of patches) expect(p.patch).not.toHaveProperty('setType');
  });
  it('a source with no rest of its own (a drop) leaves every rest alone', () => {
    const a = set({ restSeconds: 90 });
    const drop = set({ setType: 'drop', targetWeightKg: 5, restSeconds: 0 });
    expect(applyToAllPatches([a, drop], 1, [true, true])).toEqual([
      { id: a.id, patch: { targetRepsMin: 12, targetRepsMax: 12, targetWeightKg: 5, targetDurationS: null, targetDistanceM: null } },
    ]);
  });
  it('returns nothing when every set already matches', () => {
    expect(applyToAllPatches([set(), set()], 0, [true, true])).toEqual([]);
  });
});
