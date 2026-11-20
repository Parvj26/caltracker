import { describe, expect, it } from 'vitest';
import type { StrengthPoint } from '../../src/awards/strength-series';
import { startLogFromWorkout } from '../../src/logs/start';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { compareWithLast, sessionBestRows } from '../../src/progress/session-best';
import { fixtureWorkout, uuid } from '../logs/fixture';

const T0 = '2026-11-19T10:00:00.000Z';

/** The fixture's bench press with the given done sets (kg × reps), finished. */
function logWith(sets: Array<[number, number]>): WorkoutLogDoc {
  const log = startLogFromWorkout(fixtureWorkout(), uuid, T0);
  const ex = log.blocks[0]!.exercises[0]!;
  ex.sets = sets.map(([kg, reps]) => ({ ...ex.sets[1]!, id: uuid(), setType: 'normal' as const, actualWeightKg: kg, actualReps: reps, completedAt: T0 }));
  log.blocks = [log.blocks[0]!];
  return { ...log, status: 'completed', finishedAt: T0 };
}

const point = (date: string, kg: number, reps: number, logId: string): StrengthPoint => ({
  date: date as StrengthPoint['date'],
  e1rmKg: 0,
  bestSet: { weightKg: kg, reps },
  heaviestSet: { weightKg: kg, reps },
  logId,
});

describe('compareWithLast', () => {
  it('says the change in weight first, then reps, in the client units', () => {
    expect(compareWithLast({ weightKg: 60, reps: 8 }, { weightKg: 57.5, reps: 8 }, 'kg', 'weight')).toEqual({ text: '+2.5 kg vs last time', tone: 'up' });
    expect(compareWithLast({ weightKg: 55, reps: 8 }, { weightKg: 60, reps: 8 }, 'kg', 'weight')).toEqual({ text: '−5 kg vs last time', tone: 'down' });
    expect(compareWithLast({ weightKg: 60, reps: 10 }, { weightKg: 60, reps: 8 }, 'kg', 'weight')).toEqual({ text: '+2 reps vs last time', tone: 'up' });
    expect(compareWithLast({ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }, 'kg', 'weight')).toEqual({ text: 'Same as last time', tone: 'same' });
    expect(compareWithLast({ weightKg: 60, reps: 8 }, null, 'kg', 'weight')).toEqual({ text: 'First time', tone: 'first' });
  });
  it('treats less help as progress on an assisted lift', () => {
    expect(compareWithLast({ weightKg: 20, reps: 8 }, { weightKg: 30, reps: 8 }, 'kg', 'assisted').tone).toBe('up');
  });
});

describe('sessionBestRows', () => {
  it('gives the heaviest set, first time and no tag with no history', () => {
    const rows = sessionBestRows(logWith([[50, 10], [60, 8]]), new Map(), 'kg');
    expect(rows).toEqual([{ exerciseId: expect.any(String), name: 'Bench press', best: '60 kg × 8', compare: { text: 'First time', tone: 'first' }, heaviestYet: false }]);
  });
  it('compares with the workout before and tags the heaviest yet (ignoring this log in the saved series)', () => {
    const log = logWith([[60, 8]]);
    const id = log.blocks[0]!.exercises[0]!.exerciseId;
    const history = new Map([[id, [point('2026-11-10', 55, 8, 'a'), point('2026-11-15', 57.5, 8, 'b'), point('2026-11-19', 60, 8, log.id)]]]);
    const [row] = sessionBestRows(log, history, 'kg');
    expect(row!.compare).toEqual({ text: '+2.5 kg vs last time', tone: 'up' });
    expect(row!.heaviestYet).toBe(true);
  });
  it('does not tag a tie with an earlier best', () => {
    const log = logWith([[60, 8]]);
    const id = log.blocks[0]!.exercises[0]!.exerciseId;
    const [row] = sessionBestRows(log, new Map([[id, [point('2026-11-10', 60, 8, 'a')]]]), 'kg');
    expect(row!.compare?.tone).toBe('same');
    expect(row!.heaviestYet).toBe(false);
  });
  it('leaves the comparison out while the history is unknown', () => {
    expect(sessionBestRows(logWith([[60, 8]]), null, 'kg')[0]!.compare).toBeNull();
  });
});
