import { describe, expect, it } from 'vitest';
import { strengthExercises, strengthSeries } from '../../src/awards/strength-series';
import { EX_A, EX_B, mkLog } from './helpers';

const at = (day: string) => ({ startedAt: `${day}T09:00:00.000Z`, finishedAt: `${day}T10:00:00.000Z` });

describe('strengthSeries', () => {
  it('gives one point per log, sorted by date, using the set with the highest e1RM and no warm-ups', () => {
    const logs = [
      mkLog([{ sets: [{ w: 100, r: 5 }] }], at('2026-11-03')),
      mkLog([{ sets: [{ w: 140, r: 1, type: 'warmup' }, { w: 60, r: 10 }, { w: 80, r: 5 }] }], at('2026-10-20')),
      mkLog([{ sets: [{ w: 100, r: 8 }, { w: 105, r: 3 }] }], at('2026-10-27')),
    ];
    expect(strengthSeries(logs, EX_A)).toEqual([
      { date: '2026-10-20', e1rmKg: 93.3, bestSet: { weightKg: 80, reps: 5 } },
      { date: '2026-10-27', e1rmKg: 126.7, bestSet: { weightKg: 100, reps: 8 } },
      { date: '2026-11-03', e1rmKg: 116.7, bestSet: { weightKg: 100, reps: 5 } },
    ]);
  });

  it('skips logs without a counted set of the exercise, unfinished sets, discarded and in-progress logs', () => {
    const logs = [
      mkLog([{ exerciseId: EX_B, sets: [{ w: 50, r: 5 }] }], at('2026-10-20')),
      mkLog([{ sets: [{ w: 100, r: 5, done: false }] }], at('2026-10-21')),
      mkLog([{ sets: [{ w: 100, r: 5, type: 'warmup' }] }], at('2026-10-22')),
      mkLog([{ sets: [{ w: 100, r: 5 }] }], { ...at('2026-10-23'), status: 'discarded' }),
      mkLog([{ sets: [{ w: 100, r: 5 }] }], { ...at('2026-10-24'), status: 'in_progress', finishedAt: null }),
      mkLog([{ sets: [{ w: 0, r: 5 }] }], at('2026-10-25')),
    ];
    expect(strengthSeries(logs, EX_A)).toEqual([]);
  });

  it('ignores exercises that are not tracked by weight and reps', () => {
    const logs = [mkLog([{ trackingType: 'reps_only', sets: [{ w: 0, r: 20 }] }], at('2026-10-20'))];
    expect(strengthSeries(logs, EX_A)).toEqual([]);
  });

  it('keeps two logs on the same day as two points, earliest finish first', () => {
    const logs = [
      mkLog([{ sets: [{ w: 90, r: 5 }] }], { startedAt: '2026-10-20T17:00:00.000Z', finishedAt: '2026-10-20T18:00:00.000Z' }),
      mkLog([{ sets: [{ w: 80, r: 5 }] }], { startedAt: '2026-10-20T08:00:00.000Z', finishedAt: '2026-10-20T09:00:00.000Z' }),
    ];
    expect(strengthSeries(logs, EX_A).map((p) => p.bestSet.weightKg)).toEqual([80, 90]);
  });

  it('takes the date in the given time zone', () => {
    const logs = [mkLog([{ sets: [{ w: 100, r: 5 }] }], { startedAt: '2026-10-20T22:00:00.000Z', finishedAt: '2026-10-20T23:30:00.000Z' })];
    expect(strengthSeries(logs, EX_A)[0]?.date).toBe('2026-10-20');
    expect(strengthSeries(logs, EX_A, 'Pacific/Auckland')[0]?.date).toBe('2026-10-21');
  });
});

describe('strengthExercises', () => {
  it('lists the exercises that have a series, sorted by name', () => {
    const a = mkLog([{ sets: [{ w: 100, r: 5 }] }, { exerciseId: EX_B, sets: [{ w: 50, r: 5 }] }], at('2026-10-20'));
    a.blocks[0]!.exercises[0]!.exerciseName = 'Squat';
    a.blocks[1]!.exercises[0]!.exerciseName = 'Bench Press';
    const b = mkLog([{ exerciseId: '00000000-0000-4000-8000-0000000000cc', sets: [{ w: 30, r: 5, type: 'warmup' }] }], at('2026-10-21'));
    expect(strengthExercises([a, b])).toEqual([
      { exerciseId: EX_B, name: 'Bench Press' },
      { exerciseId: EX_A, name: 'Squat' },
    ]);
  });
});
