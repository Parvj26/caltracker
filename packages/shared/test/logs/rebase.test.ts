import { describe, expect, it } from 'vitest';
import { completeSet, discardLog, setLogNotes, updateActual } from '../../src/logs/ops';
import { rebaseEdits, type LogEdit } from '../../src/logs/rebase';
import { startLogFromWorkout } from '../../src/logs/start';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-06T10:00:00.000Z';
const T1 = '2026-11-06T10:05:00.000Z';
const sets = (log: WorkoutLogDoc) => log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets));

describe('rebaseEdits', () => {
  it('re-applies unsaved edits on top of the server copy, keeping both sides', () => {
    const base = { ...startLogFromWorkout(fixtureWorkout(), uuid, T0), revision: 3 };
    const [first, second] = sets(base);
    // The server got the client's final save: set 1 ticked, revision 4.
    const server = { ...completeSet(base, first!.id, T1), revision: 4 };
    // This page had ticked set 2 and typed 12 reps into it, on the older copy.
    const edits: LogEdit[] = [(l) => completeSet(l, second!.id, T1), (l) => updateActual(l, second!.id, { actualReps: 12 })];
    const out = rebaseEdits(server, edits);
    const [s1, s2] = sets(out.doc);
    expect(s1!.completedAt).not.toBeNull();
    expect(s2!.completedAt).not.toBeNull();
    expect(s2!.actualReps).toBe(12);
    expect(out.doc.revision).toBe(6);
    expect(out.unsaved.map((u) => u.revision)).toEqual([5, 6]);
  });

  it('drops edits that no longer change anything', () => {
    const server = { ...startLogFromWorkout(fixtureWorkout(), uuid, T0), revision: 4, notes: 'Newer note' };
    const out = rebaseEdits(server, [(l) => setLogNotes(l, 'Newer note', T1), (l) => updateActual(l, 'missing-set', { actualReps: 1 })]);
    expect(out.doc).toBe(server);
    expect(out.unsaved).toEqual([]);
  });

  it('applies nothing to a log that is no longer in progress', () => {
    const server = discardLog({ ...startLogFromWorkout(fixtureWorkout(), uuid, T0), revision: 4 }, T1);
    const out = rebaseEdits(server, [(l) => completeSet(l, sets(l)[0]!.id, T1)]);
    expect(out.doc).toBe(server);
  });
});
