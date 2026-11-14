import { describe, expect, it } from 'vitest';
import { completeAllOpenSets } from '../../src/logs/coach-session';
import { completeSet } from '../../src/logs/ops';
import { startLogFromWorkout } from '../../src/logs/start';
import { completedSetCount, openSetCount, untickedSets } from '../../src/logs/summary';
import { fixtureSectionedWorkout, fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-05T10:00:00.000Z';
const T1 = '2026-11-05T10:30:00.000Z';

describe('untickedSets', () => {
  it('lists each exercise with open sets, by name, with its ticked count', () => {
    let log = startLogFromWorkout(fixtureWorkout(), uuid, T0);
    // Tick the straight block's warm-up and first working set.
    const straight = log.blocks[0]!.exercises[0]!;
    log = completeSet(log, straight.sets[0]!.id, T1);
    log = completeSet(log, straight.sets[1]!.id, T1);
    const u = untickedSets(log);
    expect(u.open).toBe(openSetCount(log));
    expect(u.done).toBe(2);
    expect(u.rows.map((r) => [r.name, r.done, r.total])).toEqual([
      ['Bench press', 2, 5],
      ['Bench press', 0, 3],
      ['Bench press', 0, 3],
    ]);
    expect(u.rows.every((r) => r.needsPick === false)).toBe(true);
  });

  it('leaves out exercises with every set ticked', () => {
    let log = startLogFromWorkout(fixtureWorkout(), uuid, T0);
    for (const s of log.blocks[0]!.exercises[0]!.sets) log = completeSet(log, s.id, T1);
    expect(untickedSets(log).rows).toHaveLength(2);
  });

  it('has no rows once every set is ticked', () => {
    const log = completeAllOpenSets(startLogFromWorkout(fixtureWorkout(), uuid, T0), () => [], T1);
    expect(untickedSets(log)).toEqual({ open: 0, done: completedSetCount(log), rows: [] });
  });

  it('shows a pick-one group not yet picked as its options, still to pick', () => {
    const log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const choice = log.blocks.find((b) => b.kind === 'choice')!;
    const row = untickedSets(log).rows.find((r) => r.key === choice.id)!;
    expect(row.needsPick).toBe(true);
    expect(row.name).toBe(choice.exercises.map((e) => e.exerciseName).join(' or '));
    expect(row.done).toBe(0);
    expect(untickedSets(log).open).toBe(openSetCount(log));
  });
});

describe('completeAllOpenSets', () => {
  it('ticks every open set of every page, with last time for each exercise', () => {
    const log = startLogFromWorkout(fixtureWorkout(), uuid, T0);
    const asked: string[] = [];
    const out = completeAllOpenSets(
      log,
      (blockId, exerciseId) => {
        asked.push(`${blockId}:${exerciseId}`);
        return [];
      },
      T1,
    );
    expect(openSetCount(out)).toBe(0);
    expect(completedSetCount(out)).toBe(openSetCount(log));
    expect(asked.length).toBeGreaterThan(0);
    expect(out.status).toBe('in_progress');
  });

  it('leaves a pick-one group that has no pick yet', () => {
    const log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const out = completeAllOpenSets(log, () => [], T1);
    const choice = out.blocks.find((b) => b.kind === 'choice')!;
    expect(choice.exercises.every((e) => e.sets.every((s) => s.completedAt === null))).toBe(true);
    expect(untickedSets(out).rows.map((r) => r.key)).toEqual([choice.id]);
  });

  it('returns the same log when nothing is open', () => {
    const once = completeAllOpenSets(startLogFromWorkout(fixtureWorkout(), uuid, T0), () => [], T1);
    expect(completeAllOpenSets(once, () => [], T1)).toBe(once);
  });
});
