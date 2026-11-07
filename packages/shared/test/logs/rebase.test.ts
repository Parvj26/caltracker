import { describe, expect, it } from 'vitest';
import { completeSet, completeSetWith, discardLog, setLogNotes, updateActual } from '../../src/logs/ops';
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

  it('merges edits of the same set: the phone\'s tick and numbers stay, the coach\'s field edits go on top', () => {
    const base = { ...startLogFromWorkout(fixtureWorkout(), uuid, T0), revision: 3 };
    const set = sets(base)[1]!;
    // The phone ticked the set with 12 reps at 60 kg (its final save, stored 1000 above the take over).
    const ticked = updateActual(completeSet(base, set.id, T1), set.id, { actualReps: 12, actualWeightKg: 60 });
    const server = { ...ticked, revision: 1003 };
    // On its older copy, the coach ticked the same set (with the pre-filled 8 × 60) and typed 70 kg into it.
    const edits: LogEdit[] = [
      (l) => completeSetWith(l, set.id, { reps: 8, weightKg: 60, durationS: null, distanceM: null }, T1),
      (l) => updateActual(l, set.id, { actualWeightKg: 70 }),
    ];
    const out = rebaseEdits(server, edits);
    const merged = sets(out.doc)[1]!;
    expect(merged.completedAt).not.toBeNull();
    expect(merged.actualReps).toBe(12);
    expect(merged.actualWeightKg).toBe(70);
    // The tick was already there (a tick never untoggles on replay), so only the weight is still unsaved, above the
    // server's revision.
    expect(out.unsaved.map((u) => u.revision)).toEqual([1004]);
    expect(out.doc.revision).toBe(1004);
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
