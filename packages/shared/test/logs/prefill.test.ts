import { describe, expect, it } from 'vitest';
import type { ResultSet } from '../../src/logs/format';
import { EMPTY_VALUES, lastTimeFor, resolveSetValues, valuesToPatch } from '../../src/logs/prefill';
import type { LogExerciseDoc, LogSetDoc, LogSetTarget } from '../../src/logs/schema';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

type Target = Partial<LogSetTarget>;
type Actual = Partial<Pick<LogSetDoc, 'actualReps' | 'actualWeightKg' | 'actualDurationS' | 'actualDistanceM'>>;

const logSet = (setType: LogSetDoc['setType'], target: Target = {}, actual: Actual = {}, completed = false): LogSetDoc => ({
  id: id(),
  setType,
  target: {
    repsMin: null,
    repsMax: null,
    weightKg: null,
    durationS: null,
    distanceM: null,
    toFailure: false,
    restSeconds: null,
    ...target,
  },
  actualReps: null,
  actualWeightKg: null,
  actualDurationS: null,
  actualDistanceM: null,
  completedAt: completed ? '2026-11-06T10:00:00.000Z' : null,
  ...actual,
});

const ex = (sets: LogSetDoc[], trackingType: LogExerciseDoc['trackingType'] = 'weight_reps') => ({ sets, trackingType });

const prev = (setType: ResultSet['setType'], w: number | null, r: number | null = null): ResultSet => ({
  setType,
  actualReps: r,
  actualWeightKg: w,
  actualDurationS: null,
  actualDistanceM: null,
});

const plan = { repsMin: 8, repsMax: 10, weightKg: 60 };

describe('resolveSetValues', () => {
  it("uses the coach's numbers", () => {
    const e = ex([logSet('normal', plan)]);
    expect(resolveSetValues(e, e.sets[0]!.id, [])).toEqual({ reps: 10, weightKg: 60, durationS: null, distanceM: null });
  });

  it('carries a changed weight forward', () => {
    const e = ex([logSet('normal', plan, { actualWeightKg: 62.5 }), logSet('normal', plan)]);
    const v = resolveSetValues(e, e.sets[1]!.id, []);
    expect(v.weightKg).toBe(62.5);
    expect(v.reps).toBe(10);
  });

  it("keeps the coach's pyramid", () => {
    const e = ex([logSet('normal', plan, { actualWeightKg: 62.5 }), logSet('normal', { ...plan, weightKg: 70 })]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBe(70);
  });

  it('blank coach weight carries the earlier set', () => {
    const e = ex([logSet('normal', {}, { actualWeightKg: 40 }), logSet('normal')]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBe(40);
  });

  it('blank coach weight uses last time', () => {
    const e = ex([logSet('normal'), logSet('normal'), logSet('normal')]);
    const last = [prev('normal', 42), prev('normal', 44)];
    expect(e.sets.map((s) => resolveSetValues(e, s.id, last).weightKg)).toEqual([42, 44, 44]);
  });

  it("warm-ups don't carry into working sets", () => {
    const e = ex([logSet('warmup', {}, { actualWeightKg: 20 }), logSet('normal')]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBeNull();
    const last = [prev('warmup', 20)];
    expect(resolveSetValues(e, e.sets[0]!.id, last).weightKg).toBe(20);
    expect(resolveSetValues(e, e.sets[1]!.id, last).weightKg).toBeNull();
  });

  it('skipped earlier set', () => {
    const e = ex([
      logSet('normal', plan, { actualWeightKg: 62.5 }),
      logSet('normal', plan),
      logSet('normal', plan),
    ]);
    expect(resolveSetValues(e, e.sets[2]!.id, []).weightKg).toBe(62.5);
  });

  it('typed value wins', () => {
    const e = ex([logSet('normal', plan, { actualWeightKg: 62.5 }), logSet('normal', plan, { actualWeightKg: 55 })]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBe(55);
  });

  it("drop uses coach's drop weight", () => {
    const e = ex([logSet('normal', plan), logSet('drop', { ...plan, weightKg: 40 })]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBe(40);
  });

  it('client-added drop starts at the step above', () => {
    const e = ex([logSet('normal', {}, { actualWeightKg: 60 }), logSet('drop', {}, { actualWeightKg: 50 }), logSet('drop')]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBe(50);
    expect(resolveSetValues(e, e.sets[2]!.id, []).weightKg).toBe(50);
    const f = ex([logSet('normal', {}, { actualWeightKg: 60 }), logSet('drop')]);
    expect(resolveSetValues(f, f.sets[1]!.id, []).weightKg).toBe(60);
  });

  it('reps carry for an unplanned exercise', () => {
    const e = ex([logSet('normal', {}, { actualReps: 12 }), logSet('normal')]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).reps).toBe(12);
  });

  it('untracked fields are null', () => {
    const e = ex([logSet('normal', plan)], 'reps');
    expect(resolveSetValues(e, e.sets[0]!.id, [prev('normal', 50, 5)])).toEqual({
      reps: 10,
      weightKg: null,
      durationS: null,
      distanceM: null,
    });
  });

  it('time exercise', () => {
    const e = ex([logSet('normal', { durationS: 45 })], 'time');
    expect(resolveSetValues(e, e.sets[0]!.id, [])).toEqual({ reps: null, weightKg: null, durationS: 45, distanceM: null });
  });

  it('unknown set id gives empty values', () => {
    expect(resolveSetValues(ex([logSet('normal', plan)]), 'nope', [])).toEqual(EMPTY_VALUES);
  });
});

describe('resolveSetValues edge cases', () => {
  it('an actual of 0 carries forward', () => {
    const e = ex([logSet('normal', plan, { actualWeightKg: 0 }), logSet('normal', plan)]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBe(0);
  });

  it('carries decimals', () => {
    const e = ex([logSet('normal', {}, { actualWeightKg: 62.5, actualReps: 8 }), logSet('normal')]);
    expect(resolveSetValues(e, e.sets[1]!.id, [])).toMatchObject({ weightKg: 62.5, reps: 8 });
  });

  it('a drop with no weight does not inherit from a warm-up above', () => {
    const e = ex([logSet('warmup', {}, { actualWeightKg: 20 }), logSet('drop')]);
    expect(resolveSetValues(e, e.sets[1]!.id, []).weightKg).toBeNull();
  });

  it('a drop with no coach weight and nothing above falls through to last time', () => {
    const e = ex([logSet('drop')]);
    expect(resolveSetValues(e, e.sets[0]!.id, [prev('drop', 30)]).weightKg).toBe(30);
  });

  it('reps carry while weight follows the coach', () => {
    const e = ex([
      logSet('normal', plan, { actualReps: 7, actualWeightKg: 60 }),
      logSet('normal', { ...plan, weightKg: 70, repsMin: null, repsMax: null }),
    ]);
    expect(resolveSetValues(e, e.sets[1]!.id, [])).toMatchObject({ reps: 7, weightKg: 70 });
  });

  it('a warm-up that is not first carries from the earlier warm-up', () => {
    const e = ex([logSet('normal', plan), logSet('warmup', {}, { actualWeightKg: 20 }), logSet('warmup')]);
    expect(resolveSetValues(e, e.sets[2]!.id, []).weightKg).toBe(20);
  });
});

describe('lastTimeFor', () => {
  it('matches the nth set of the same type, else the last of that type, else null', () => {
    const sets = [logSet('warmup'), logSet('normal'), logSet('normal'), logSet('normal')];
    const last = [prev('warmup', 20), prev('normal', 42), prev('normal', 44)];
    expect(lastTimeFor(sets, 0, last)?.actualWeightKg).toBe(20);
    expect(lastTimeFor(sets, 1, last)?.actualWeightKg).toBe(42);
    expect(lastTimeFor(sets, 3, last)?.actualWeightKg).toBe(44);
    expect(lastTimeFor(sets, 1, [])).toBeNull();
    expect(lastTimeFor([logSet('drop')], 0, last)).toBeNull();
  });

  it('uses the right drop index', () => {
    const sets = [logSet('normal'), logSet('drop'), logSet('drop')];
    const last = [prev('normal', 60), prev('drop', 50), prev('drop', 40)];
    expect(lastTimeFor(sets, 1, last)?.actualWeightKg).toBe(50);
    expect(lastTimeFor(sets, 2, last)?.actualWeightKg).toBe(40);
  });
});

describe('valuesToPatch', () => {
  it('maps names one to one', () => {
    expect(valuesToPatch({ reps: 1, weightKg: 2, durationS: 3, distanceM: 4 })).toEqual({
      actualReps: 1,
      actualWeightKg: 2,
      actualDurationS: 3,
      actualDistanceM: 4,
    });
  });
});
