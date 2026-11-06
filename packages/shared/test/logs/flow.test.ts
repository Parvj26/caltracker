import { describe, expect, it } from 'vitest';
import { afterDone, blockRoundCount, blockSteps, currentStep, doneLabel, isBlockDone, nextOpenBlock } from '../../src/logs/flow';
import { removeLogSet } from '../../src/logs/ops';
import { startLogFromWorkout } from '../../src/logs/start';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { fixtureWorkout, uuid } from './fixture';

const NOW = '2026-11-06T10:00:00.000Z';
const fresh = () => startLogFromWorkout(fixtureWorkout(), uuid, NOW);

function tick(log: WorkoutLogDoc, ...ids: string[]): WorkoutLogDoc {
  return {
    ...log,
    blocks: log.blocks.map((b) => ({
      ...b,
      exercises: b.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => (ids.includes(s.id) ? { ...s, completedAt: NOW } : s)),
      })),
    })),
  };
}
const tickBlock = (log: WorkoutLogDoc, bi: number) =>
  tick(log, ...log.blocks[bi]!.exercises.flatMap((e) => e.sets.map((s) => s.id)));
const withRest = (log: WorkoutLogDoc, setId: string, restSeconds: number): WorkoutLogDoc => ({
  ...log,
  blocks: log.blocks.map((b) => ({
    ...b,
    exercises: b.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => (s.id === setId ? { ...s, target: { ...s.target, restSeconds } } : s)),
    })),
  })),
});
const ids = (log: WorkoutLogDoc, bi: number, ei: number) => log.blocks[bi]!.exercises[ei]!.sets.map((s) => s.id);

describe('blockSteps', () => {
  it('straight steps follow set order', () => {
    const steps = blockSteps(fresh().blocks[0]!);
    expect(steps.map((s) => s.kind)).toEqual(['warmup', 'normal', 'normal', 'normal', 'drop']);
    expect(steps[4]).toMatchObject({ dropNumber: 1, round: 4 });
    expect(steps[0]!.dropNumber).toBeNull();
  });

  it('superset steps go round by round', () => {
    const block = fresh().blocks[1]!;
    const steps = blockSteps(block);
    expect(steps.map((s) => s.exerciseIndex)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(steps.map((s) => s.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(blockRoundCount(block)).toBe(3);
  });

  it('uneven superset', () => {
    let log = fresh();
    log = removeLogSet(log, log.blocks[1]!.exercises[1]!.id, ids(log, 1, 1)[2]!, NOW);
    expect(blockSteps(log.blocks[1]!).map((s) => s.exerciseIndex)).toEqual([0, 1, 0, 1, 0]);
    const a3 = ids(log, 1, 0)[2]!;
    expect(afterDone(log, 1, a3)).toEqual({ kind: 'rest', seconds: 90, round: 3 });
    expect(afterDone(tickBlock(log, 0), 1, a3)).toEqual({ kind: 'rest', seconds: 90, round: 3 });
    const done = tick(tickBlock(log, 0), ...ids(log, 1, 0).slice(0, 2), ...ids(log, 1, 1));
    expect(afterDone(done, 1, a3)).toEqual({ kind: 'last' });
  });
});

describe('currentStep', () => {
  it('goes back to a skipped set', () => {
    const log = fresh();
    const [w, s1, s2] = ids(log, 0, 0);
    const ticked = tick(log, w!, s2!);
    expect(currentStep(ticked.blocks[0]!)?.setId).toBe(s1);
  });

  it('prefers the tapped superset exercise', () => {
    const block = fresh().blocks[1]!;
    expect(currentStep(block)?.exerciseIndex).toBe(0);
    expect(currentStep(block, 1)?.exerciseIndex).toBe(1);
  });

  it('falls back when the preferred exercise is finished, and is null when done', () => {
    let log = fresh();
    log = tick(log, ...ids(log, 1, 1));
    expect(currentStep(log.blocks[1]!, 1)?.exerciseIndex).toBe(0);
    log = tickBlock(log, 1);
    expect(currentStep(log.blocks[1]!)).toBeNull();
    expect(isBlockDone(log.blocks[1]!)).toBe(true);
  });
});

describe('afterDone and doneLabel', () => {
  it('set 3 goes straight to the drop', () => {
    const log = fresh();
    const a = afterDone(log, 0, ids(log, 0, 0)[3]!);
    expect(a).toEqual({ kind: 'drop', dropNumber: 1 });
    expect(doneLabel(a, null)).toBe('Done · straight to drop 1');
  });

  it('drop chain rests with the main set rest', () => {
    const log = fresh();
    const a = afterDone(log, 0, ids(log, 0, 0)[4]!);
    expect(a).toEqual({ kind: 'rest', seconds: 90, round: null });
  });

  it('superset goes straight to the next exercise', () => {
    const log = fresh();
    const a = afterDone(log, 1, ids(log, 1, 0)[0]!);
    expect(a).toEqual({ kind: 'superset-next', exerciseIndex: 1 });
    expect(doneLabel(a, 'A')).toBe('Done · straight to A2');
  });

  it('end of round with rest', () => {
    const log = fresh();
    const a = afterDone(log, 1, ids(log, 1, 1)[0]!);
    expect(a).toEqual({ kind: 'rest', seconds: 90, round: 1 });
    expect(doneLabel(a, 'A')).toBe('Done round 1 · rest 1:30');
  });

  it('end of round without rest', () => {
    let log = fresh();
    log = withRest(withRest(log, ids(log, 1, 0)[0]!, 0), ids(log, 1, 1)[0]!, 0);
    const a = afterDone(log, 1, ids(log, 1, 1)[0]!);
    expect(a).toEqual({ kind: 'next', round: 1, pageDone: false });
    expect(doneLabel(a, 'A')).toBe('Done round 1');
  });

  it('straight set with rest', () => {
    const log = fresh();
    const a = afterDone(log, 0, ids(log, 0, 0)[1]!);
    expect(doneLabel(a, null)).toBe('Done · start rest 1:30');
  });

  it('straight set without rest', () => {
    let log = fresh();
    const s1 = ids(log, 0, 0)[1]!;
    log = withRest(log, s1, 0);
    const a = afterDone(log, 0, s1);
    expect(a).toEqual({ kind: 'next', round: null, pageDone: false });
    expect(doneLabel(a, null)).toBe('Done · next set');
  });

  it('page finished without rest', () => {
    let log = fresh();
    const drop = ids(log, 0, 0)[4]!;
    log = withRest(tick(log, ...ids(log, 0, 0).slice(0, 4)), ids(log, 0, 0)[3]!, 0);
    const a = afterDone(log, 0, drop);
    expect(a).toEqual({ kind: 'next', round: null, pageDone: true });
    expect(doneLabel(a, null)).toBe('Done · next exercise');
  });

  it('last set', () => {
    let log = fresh();
    const lastId = ids(log, 1, 1)[2]!;
    log = tick(log, ...ids(log, 0, 0), ...ids(log, 1, 0), ...ids(log, 1, 1).slice(0, 2));
    const a = afterDone(log, 1, lastId);
    expect(a).toEqual({ kind: 'last' });
    expect(doneLabel(a, 'A')).toBe('Done · last set');
  });

  it('superset round uses the longest rest', () => {
    let log = fresh();
    const [a1, b1] = [ids(log, 1, 0)[0]!, ids(log, 1, 1)[0]!];
    const x = withRest(withRest(log, a1, 0), b1, 60);
    expect(afterDone(x, 1, b1)).toEqual({ kind: 'rest', seconds: 60, round: 1 });
    log = withRest(withRest(log, a1, 120), b1, 0);
    expect(afterDone(log, 1, b1)).toEqual({ kind: 'rest', seconds: 120, round: 1 });
  });
});

describe('nextOpenBlock', () => {
  it('wraps to skipped pages', () => {
    const log = fresh();
    expect(nextOpenBlock(log, 0)).toBe(1);
    expect(nextOpenBlock(log, 1)).toBe(0);
    expect(nextOpenBlock(tickBlock(log, 1), 1)).toBe(0);
  });

  it('is null when everything is done', () => {
    const log = tickBlock(tickBlock(fresh(), 0), 1);
    expect(nextOpenBlock(log, 0)).toBeNull();
  });
});
