import { describe, expect, it } from 'vitest';
import { completeSetWith, pickChoice } from '../../src/logs/ops';
import type { LogExerciseDoc, WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import {
  elapsedClock,
  exerciseProgressLabel,
  liveSetLine,
  liveStats,
  orderTrainingTabs,
  tickNote,
  upNext,
  whereTheyAre,
} from '../../src/logs/live';
import { fixtureSectionedWorkout, fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-05T10:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

/** Straight block [W, S1, S2, S3, drop] then superset A x3 / B x3. */
const fresh = (): WorkoutLogDoc => startLogFromWorkout(fixtureWorkout(), uuid, T0);
const exercises = (log: WorkoutLogDoc): LogExerciseDoc[] => log.blocks.flatMap((b) => b.exercises);
/** Ticks set `setIndex` of exercise `exIndex` (in log order) with these numbers, at minute `minute`. */
function tick(log: WorkoutLogDoc, exIndex: number, setIndex: number, minute: number, values = { weightKg: 60, reps: 10, durationS: null, distanceM: null }) {
  const set = exercises(log)[exIndex]!.sets[setIndex]!;
  return completeSetWith(log, set.id, values, at(minute));
}
const tickAll = (log: WorkoutLogDoc, exIndex: number, minute: number) =>
  exercises(log)[exIndex]!.sets.reduce((l, _s, i) => tick(l, exIndex, i, minute), log);

describe('whereTheyAre', () => {
  it('is the first exercise when nothing is ticked yet', () => {
    const log = fresh();
    expect(whereTheyAre(log)).toMatchObject({ blockIndex: 0, exerciseId: exercises(log)[0]!.id, lastTicked: null });
  });

  it('stays on the exercise of the latest tick while it still has unticked sets', () => {
    const log = tick(tick(fresh(), 0, 0, 1), 0, 1, 2);
    const here = whereTheyAre(log)!;
    expect(here.exerciseId).toBe(exercises(log)[0]!.id);
    expect(here.lastTicked).toEqual({ exerciseId: exercises(log)[0]!.id, setIndex: 1, completedAt: at(2) });
  });

  it('moves on to the next exercise with unticked sets once that one is done', () => {
    const log = tickAll(fresh(), 0, 3);
    expect(whereTheyAre(log)).toMatchObject({ blockIndex: 1, exerciseId: exercises(log)[1]!.id });
  });

  it('follows the most recent tick, not the first open set (they skipped ahead)', () => {
    // Set 1 of the bench, then they jump to the superset's B.
    let log = tick(fresh(), 0, 1, 1);
    log = tick(log, 2, 0, 5);
    const here = whereTheyAre(log)!;
    expect(here.exerciseId).toBe(exercises(log)[2]!.id);
    expect(here.blockIndex).toBe(1);
  });

  it('wraps to an earlier exercise when everything after the latest tick is done', () => {
    let log = tickAll(fresh(), 1, 1);
    log = tickAll(log, 2, 2);
    expect(whereTheyAre(log)).toMatchObject({ blockIndex: 0, exerciseId: exercises(log)[0]!.id });
  });

  it('gives the superset round they are on', () => {
    let log = tickAll(fresh(), 0, 1);
    log = tick(log, 1, 0, 2); // A1
    log = tick(log, 2, 0, 3); // B1
    log = tick(log, 1, 1, 4); // A2
    const here = whereTheyAre(log)!;
    expect(here.exerciseId).toBe(exercises(log)[1]!.id);
    expect(here.round).toBe(2);
    expect(here.rounds).toBe(3);
  });

  it('has no round for a straight exercise', () => {
    expect(whereTheyAre(fresh())).toMatchObject({ round: null, rounds: null });
  });

  it('is null once every set is ticked', () => {
    const log = [0, 1, 2].reduce((l, i) => tickAll(l, i, i), fresh());
    expect(whereTheyAre(log)).toBeNull();
  });

  it('stops at a pick-one group nobody has picked from yet (no exercise)', () => {
    const log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const done = tickAll(tickAll(log, 0, 1), 1, 2); // Warm-Up's and Resistance's first exercises
    const here = whereTheyAre(done)!;
    expect(here.blockIndex).toBe(2);
    expect(here.exerciseId).toBeNull();
  });

  it('uses the picked option of a pick-one group', () => {
    const log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const choice = log.blocks[2]!;
    const picked = pickChoice(tickAll(tickAll(log, 0, 1), 1, 2), choice.id, choice.exercises[1]!.id, at(3));
    expect(whereTheyAre(picked)).toMatchObject({ blockIndex: 2, exerciseId: choice.exercises[1]!.id });
  });
});

describe('upNext', () => {
  it('lists the exercises after the one they are on, with the sets still to do', () => {
    const log = fresh();
    const [, a, b] = exercises(log);
    expect(upNext(log)).toEqual([
      { blockIndex: 1, exerciseId: a!.id, name: 'Bench press', setsLeft: 3, section: null },
      { blockIndex: 1, exerciseId: b!.id, name: 'Bench press', setsLeft: 3, section: null },
    ]);
  });

  it('skips the current exercise and anything already done, and counts only unticked sets', () => {
    let log = tickAll(fresh(), 0, 1);
    log = tick(log, 1, 0, 2); // A1
    log = tick(log, 2, 0, 3); // B1
    log = tick(log, 1, 1, 4); // A2: they are on the superset's A
    const b = exercises(log)[2]!;
    expect(upNext(log)).toEqual([{ blockIndex: 1, exerciseId: b.id, name: 'Bench press', setsLeft: 2, section: null }]);
  });

  it('wraps round to an exercise they skipped', () => {
    let log = tick(fresh(), 0, 1, 1);
    log = tick(log, 2, 0, 5); // jumped ahead to B
    expect(upNext(log).map((n) => n.exerciseId)).toEqual([exercises(log)[0]!.id, exercises(log)[1]!.id]);
  });

  it('keeps to the limit and names the section', () => {
    const log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const next = upNext(log, 2);
    expect(next.map((n) => [n.blockIndex, n.section])).toEqual([
      [1, 'Resistance Training'],
      [2, 'Resistance Training'],
    ]);
  });

  it('shows a pick-one group not picked yet as one entry naming every option', () => {
    const log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const choice = upNext(log).find((n) => n.blockIndex === 2)!;
    expect(choice).toEqual({ blockIndex: 2, exerciseId: null, name: 'Exercise or Exercise', setsLeft: 3, section: 'Resistance Training' });
  });

  it('is empty once every set is ticked, and when only the current exercise is left', () => {
    const all = [0, 1, 2].reduce((l, i) => tickAll(l, i, i), fresh());
    expect(upNext(all)).toEqual([]);
    const lastOne = [0, 1].reduce((l, i) => tickAll(l, i, i), fresh());
    expect(upNext(lastOne)).toEqual([]);
  });
});

describe('liveStats', () => {
  it('counts sets, volume (the shared rule) and PRs from the award', () => {
    let log = tick(fresh(), 0, 0, 1, { weightKg: 20, reps: 10, durationS: null, distanceM: null }); // warm-up: no volume
    log = tick(log, 0, 1, 2, { weightKg: 60, reps: 10, durationS: null, distanceM: null });
    const award = { prs: [{ logId: log.id, exerciseId: 'a', achievedAt: at(2) }, { logId: log.id, exerciseId: 'a', achievedAt: at(2) }, { logId: log.id, exerciseId: 'b', achievedAt: at(2) }] };
    expect(liveStats(log, award)).toEqual({ done: 2, total: 11, volumeKg: 600, prCount: 2, prExerciseIds: ['a', 'b'], fraction: 2 / 11 });
  });

  it('has no PRs without an award', () => {
    expect(liveStats(fresh(), null)).toMatchObject({ done: 0, prCount: 0, prExerciseIds: [], fraction: 0 });
  });
});

describe('elapsedClock', () => {
  it('counts whole seconds from the start', () => {
    expect(elapsedClock(T0, Date.parse(T0) + (32 * 60 + 14) * 1000 + 600)).toBe('32:14');
    expect(elapsedClock(T0, Date.parse(T0) + 3_725_000)).toBe('1:02:05');
  });

  it('never goes below zero (a clock a little behind)', () => {
    expect(elapsedClock(T0, Date.parse(T0) - 5000)).toBe('0:00');
  });
});

describe('liveSetLine', () => {
  it('lists done sets with their actual numbers, then the planned ones', () => {
    const log = tick(fresh(), 1, 0, 1, { weightKg: 62.5, reps: 9, durationS: null, distanceM: null });
    expect(liveSetLine(exercises(log)[1]!, 'kg')).toEqual({ done: ['62.5 kg × 9'], planned: ['60 kg × 8–10', '60 kg × 8–10'] });
  });

  it('words a time set and a reps-only set like the rest of the app', () => {
    const log = fresh();
    const ex = exercises(log)[1]!;
    const timed: LogExerciseDoc = {
      ...ex,
      trackingType: 'time',
      sets: ex.sets.map((s, i) => ({ ...s, target: { ...s.target, durationS: 30 }, actualDurationS: i === 0 ? 25 : null, completedAt: i === 0 ? at(1) : null })),
    };
    expect(liveSetLine(timed, 'lb')).toEqual({ done: ['25 s'], planned: ['30 s', '30 s'] });
  });
});

describe('exerciseProgressLabel', () => {
  const ex = (done: number, total: number) =>
    ({ sets: Array.from({ length: total }, (_, i) => ({ completedAt: i < done ? T0 : null })) }) as unknown as LogExerciseDoc;
  it('reads ×m before it starts, n/m on the way, and Done for a single finished set', () => {
    expect(exerciseProgressLabel(ex(0, 3))).toEqual({ text: '×3', state: 'todo' });
    expect(exerciseProgressLabel(ex(2, 3))).toEqual({ text: '2/3', state: 'partial' });
    expect(exerciseProgressLabel(ex(3, 3))).toEqual({ text: '3/3', state: 'done' });
    expect(exerciseProgressLabel(ex(1, 1))).toEqual({ text: 'Done', state: 'done' });
  });
});

describe('tickNote', () => {
  const now = Date.parse(at(10));
  const curl = (actualKg: number, reps: number, minute: number) => {
    const ex = exercises(fresh())[1]!;
    const sets = ex.sets.map((s, i) => (i === 1 ? { ...s, actualWeightKg: actualKg, actualReps: reps, completedAt: at(minute) } : s));
    return { ...ex, sets };
  };

  it('says which set was ticked, when, and how it compares with the plan', () => {
    // Planned 60 kg × 8–10.
    expect(tickNote(curl(62, 10, 10), 1, now, 'kg')).toBe('Set 2 ticked just now · +2 kg on plan');
    expect(tickNote(curl(60, 12, 7), 1, now, 'kg')).toBe('Set 2 ticked 3 min ago · +2 reps on plan');
    expect(tickNote(curl(55, 6, 9), 1, now, 'kg')).toBe('Set 2 ticked 1 min ago · −5 kg, −2 reps on plan');
    expect(tickNote(curl(60, 9, 10), 1, now, 'kg')).toBe('Set 2 ticked just now · as planned');
  });

  it('converts the difference to the coach\'s units', () => {
    expect(tickNote(curl(60 + 0.90718474, 10, 10), 1, now, 'lb')).toBe('Set 2 ticked just now · +2 lb on plan');
  });

  it('says nothing about the plan for a set without a target', () => {
    const ex = curl(60, 10, 10);
    const bare = { ...ex, sets: ex.sets.map((s) => ({ ...s, target: { ...s.target, repsMin: null, repsMax: null, weightKg: null } })) };
    expect(tickNote(bare, 1, now, 'kg')).toBe('Set 2 ticked just now');
  });

  it('is null for a set that is not ticked', () => {
    expect(tickNote(exercises(fresh())[1]!, 0, now, 'kg')).toBeNull();
  });
});

describe('orderTrainingTabs', () => {
  it('orders by who started first, then by name, so tabs never jump around', () => {
    const tabs = [
      { logId: 'c', firstName: 'Zed', startedAt: at(5) },
      { logId: 'b', firstName: 'Parv', startedAt: at(1) },
      { logId: 'a', firstName: 'Ana', startedAt: at(5) },
      { logId: 'd', firstName: 'Ana', startedAt: at(5) },
    ];
    expect(orderTrainingTabs(tabs).map((t) => t.logId)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('does not change the input', () => {
    const tabs = [{ logId: 'b', firstName: 'B', startedAt: at(2) }, { logId: 'a', firstName: 'A', startedAt: at(1) }];
    orderTrainingTabs(tabs);
    expect(tabs[0]!.logId).toBe('b');
  });
});
