import { describe, expect, it } from 'vitest';
import type { LogSetDoc, WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import {
  AUTO_FINISH_IDLE_MS,
  REMINDER_DELAY_MS,
  REOPEN_WINDOW_MS,
  autoFinish,
  autoFinishTime,
  canReopen,
  completedSetCount,
  isAddedExercise,
  isPlannedLog,
  logDurationS,
  logVolumeKg,
  shouldAutoFinish,
} from '../../src/logs/summary';
import { fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-05T10:00:00.000Z';
const H = 60 * 60 * 1000;
const M = 60 * 1000;
const at = (iso: string, plusMs: number) => new Date(Date.parse(iso) + plusMs).toISOString();

const base = () => startLogFromWorkout(fixtureWorkout(), uuid, T0);

/** Replace the straight exercise's sets, and optionally add a reps-only exercise, with explicit actuals. */
function withSets(sets: Partial<LogSetDoc>[], extra?: Partial<LogSetDoc>[]): WorkoutLogDoc {
  const log = base();
  const ex = log.blocks[0]!.exercises[0]!;
  ex.sets = sets.map((s, i) => ({ ...ex.sets[Math.min(i, ex.sets.length - 1)]!, id: uuid(), ...s }));
  if (extra) {
    const ex2 = log.blocks[1]!.exercises[0]!;
    ex2.trackingType = 'reps';
    ex2.sets = extra.map((s) => ({ ...ex2.sets[0]!, id: uuid(), ...s }));
  }
  return log;
}

const done = (reps: number, kg: number, completedAt = at(T0, 5 * M)): Partial<LogSetDoc> => ({
  actualReps: reps,
  actualWeightKg: kg,
  completedAt,
});

describe('log summary', () => {
  it('exposes the timing constants', () => {
    expect(AUTO_FINISH_IDLE_MS).toBe(3 * H);
    expect(REMINDER_DELAY_MS).toBe(20 * M);
    expect(REOPEN_WINDOW_MS).toBe(24 * H);
  });

  it('volume counts only completed weight_reps sets', () => {
    const log = withSets(
      [done(10, 60), done(10, 60), done(10, 60), { actualReps: 10, actualWeightKg: 60, completedAt: null }],
      [{ actualReps: 15, actualWeightKg: null, completedAt: at(T0, 6 * M) }],
    );
    expect(logVolumeKg(log)).toBe(1800);
    expect(completedSetCount(log)).toBe(4);
  });

  it('volume includes warm-ups and drops', () => {
    const log = withSets([done(10, 60), { ...done(8, 40), setType: 'drop' }]);
    expect(logVolumeKg(log)).toBe(920);
    const warm = withSets([{ ...done(10, 20), setType: 'warmup' }]);
    expect(logVolumeKg(warm)).toBe(200);
  });

  it('volume treats null reps or weight as zero and rounds to 1 decimal', () => {
    const log = withSets([done(3, 33.333), { actualReps: null, actualWeightKg: 50, completedAt: at(T0, 5 * M) }]);
    expect(logVolumeKg(log)).toBe(100);
  });

  it('duration uses finishedAt when set, lastActivityAt while in progress', () => {
    const finished = { ...base(), status: 'completed' as const, finishedAt: at(T0, 45 * M) };
    expect(logDurationS(finished)).toBe(2700);
    const live = { ...base(), lastActivityAt: at(T0, 10 * M + 500) };
    expect(logDurationS(live)).toBe(600);
  });

  it('shouldAutoFinish is false at 2h59m and true at 3h, and only when in progress', () => {
    const log = { ...base(), lastActivityAt: T0 };
    expect(shouldAutoFinish(log, Date.parse(T0) + 3 * H - M)).toBe(false);
    expect(shouldAutoFinish(log, Date.parse(T0) + 3 * H)).toBe(true);
    expect(shouldAutoFinish({ ...log, status: 'completed' }, Date.parse(T0) + 4 * H)).toBe(false);
  });

  it('autoFinish completes at the last completedAt with revision + 1', () => {
    const log = { ...withSets([done(10, 60, '2026-11-05T10:05:00.000Z'), done(10, 60, '2026-11-05T10:40:00.000Z')]), revision: 4 };
    expect(autoFinishTime(log)).toBe('2026-11-05T10:40:00.000Z');
    const out = autoFinish(log);
    expect(out.status).toBe('completed');
    expect(out.autoFinished).toBe(true);
    expect(out.finishedAt).toBe('2026-11-05T10:40:00.000Z');
    expect(out.revision).toBe(5);
    expect(log.status).toBe('in_progress');
  });

  it('autoFinish with no completed sets discards, and autoFinishTime falls back to startedAt', () => {
    const log = base();
    expect(autoFinishTime(log)).toBe(T0);
    const out = autoFinish(log);
    expect(out.status).toBe('discarded');
    // Marked automatic like the server job's discard, so both say the same about what happened.
    expect(out.autoFinished).toBe(true);
    expect(out.finishedAt).toBeNull();
    expect(out.revision).toBe(log.revision + 1);
  });

  it('canReopen is true at 23h59m, false at 24h, false when not auto-finished', () => {
    const fin = '2026-11-05T12:00:00.000Z';
    const log: WorkoutLogDoc = { ...base(), status: 'completed', autoFinished: true, finishedAt: fin };
    expect(canReopen(log, Date.parse(fin) + 24 * H - M)).toBe(true);
    expect(canReopen(log, Date.parse(fin) + 24 * H)).toBe(false);
    expect(canReopen({ ...log, autoFinished: false }, Date.parse(fin) + H)).toBe(false);
    expect(canReopen({ ...log, status: 'discarded' }, Date.parse(fin) + H)).toBe(false);
  });
});

describe('planned or not', () => {
  it('a log from a plan is planned, and only its exercises with no planned link are added', () => {
    const log = base();
    expect(isPlannedLog(log)).toBe(true);
    const ex = log.blocks[0]!.exercises[0]!;
    expect(isAddedExercise(log, ex)).toBe(false);
    const added = { ...ex, id: uuid(), plannedWorkoutExerciseId: null };
    expect(isAddedExercise(log, added)).toBe(true);
  });

  it('stays planned after the plan is deleted (workoutId null), since its exercises keep their planned link', () => {
    const log = { ...base(), workoutId: null };
    expect(isPlannedLog(log)).toBe(true);
    expect(isAddedExercise(log, log.blocks[0]!.exercises[0]!)).toBe(false);
  });

  it('a log with no planned exercise is unplanned, and nothing in it counts as added', () => {
    const log = base();
    const blocks = log.blocks.map((b) => ({
      ...b,
      exercises: b.exercises.map((e) => ({ ...e, plannedWorkoutExerciseId: null })),
    }));
    const unplanned = { ...log, workoutId: null, blocks };
    expect(isPlannedLog(unplanned)).toBe(false);
    expect(isAddedExercise(unplanned, blocks[0]!.exercises[0]!)).toBe(false);
    expect(isPlannedLog({ ...unplanned, blocks: [] })).toBe(false);
  });
});
