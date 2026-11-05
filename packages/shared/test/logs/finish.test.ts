import { describe, expect, it } from 'vitest';
import { completeSet, discardLog, finishLog, toggleSet } from '../../src/logs/ops';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import { fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-05T10:00:00.000Z';
const T1 = '2026-11-05T10:20:00.000Z';
const T2 = '2026-11-05T10:45:00.000Z';

const fresh = () => startLogFromWorkout(fixtureWorkout(), uuid, T0);
const firstSetId = (log: WorkoutLogDoc) => log.blocks[0]!.exercises[0]!.sets[0]!.id;

describe('finishLog', () => {
  it('completes an in-progress log with a ticked set: finishedAt = now, revision + 1, still valid', () => {
    const log = fresh();
    const ticked = completeSet(log, firstSetId(log), T1);
    const done = finishLog(ticked, T2);
    expect(done.status).toBe('completed');
    expect(done.finishedAt).toBe(T2);
    expect(done.lastActivityAt).toBe(T2);
    expect(done.autoFinished).toBe(false);
    expect(done.revision).toBe(ticked.revision + 1);
    expect(WorkoutLogDoc.safeParse(done).success).toBe(true);
  });

  it('refuses a log with no completed set (returns the same object)', () => {
    const log = fresh();
    expect(finishLog(log, T2)).toBe(log);
  });

  it('refuses a log that is not in progress', () => {
    const log = fresh();
    const done = finishLog(completeSet(log, firstSetId(log), T1), T2);
    expect(finishLog(done, T2)).toBe(done);
    const gone = discardLog(log, T1);
    expect(finishLog(gone, T2)).toBe(gone);
  });
});

describe('discardLog', () => {
  it('discards an in-progress log, with or without ticked sets', () => {
    const log = fresh();
    const gone = discardLog(log, T1);
    expect(gone.status).toBe('discarded');
    expect(gone.finishedAt).toBeNull();
    expect(gone.lastActivityAt).toBe(T1);
    expect(gone.revision).toBe(log.revision + 1);
    expect(WorkoutLogDoc.safeParse(gone).success).toBe(true);

    const ticked = completeSet(log, firstSetId(log), T1);
    expect(discardLog(ticked, T2).status).toBe('discarded');
  });

  it('refuses a log that is already finished or discarded', () => {
    const log = fresh();
    const gone = discardLog(log, T1);
    expect(discardLog(gone, T2)).toBe(gone);
    const done = finishLog(completeSet(log, firstSetId(log), T1), T2);
    expect(discardLog(done, T2)).toBe(done);
  });
});

describe('toggleSet', () => {
  it('ticks an open set and unticks a ticked one, deciding from the doc it is given', () => {
    const log = fresh();
    const id = firstSetId(log);
    const on = toggleSet(log, id, T1);
    expect(on.completed).toBe(true);
    expect(on.log.blocks[0]!.exercises[0]!.sets[0]!.completedAt).toBe(T1);
    expect(on.log.revision).toBe(log.revision + 1);
    const off = toggleSet(on.log, id, T2);
    expect(off.completed).toBe(false);
    expect(off.log.blocks[0]!.exercises[0]!.sets[0]!.completedAt).toBeNull();
    expect(off.log.revision).toBe(on.log.revision + 1);
  });

  it('leaves the doc alone for an unknown set', () => {
    const log = fresh();
    const r = toggleSet(log, uuid(), T1);
    expect(r).toEqual({ log, completed: null });
    expect(r.log).toBe(log);
  });
});
