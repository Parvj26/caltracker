import { describe, expect, it } from 'vitest';
import { draftEdits } from '../../src/logs/draft-edits';
import { addLogSet, completeSet, setExerciseNote, setLogNotes, updateActual } from '../../src/logs/ops';
import { rebaseEdits } from '../../src/logs/rebase';
import { startLogFromWorkout } from '../../src/logs/start';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-06T10:00:00.000Z';
const T1 = '2026-11-06T10:05:00.000Z';
const T2 = '2026-11-06T10:06:00.000Z';
const sets = (log: WorkoutLogDoc) => log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets));
const exercises = (log: WorkoutLogDoc) => log.blocks.flatMap((b) => b.exercises);

function base(): WorkoutLogDoc {
  return { ...startLogFromWorkout(fixtureWorkout(), uuid, T0), revision: 5 };
}

describe('draftEdits: what a device copy changed since the copy it grew from, as edits to re-apply', () => {
  it('nothing changed: no edits', () => {
    const b = base();
    expect(draftEdits(b, b)).toEqual({ edits: [], complete: true });
  });

  it('typed numbers, ticks, unticks and notes come back as edits that redo them on another copy', () => {
    const b = { ...completeSet(base(), sets(base())[2]!.id, T0), revision: 5 };
    const [s1, s2, s3] = sets(b);
    const ex = exercises(b)[0]!;
    let draft = updateActual(b, s1!.id, { actualWeightKg: 47, actualReps: 9 });
    draft = completeSet(draft, s2!.id, T1);
    draft = { ...draft, blocks: draft.blocks.map((bl) => ({ ...bl, exercises: bl.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => (s.id === s3!.id ? { ...s, completedAt: null } : s)) })) })) };
    draft = setLogNotes(draft, 'Good session', T1);
    draft = setExerciseNote(draft, ex.id, 'Knees out', T1);
    const { edits, complete } = draftEdits(b, draft);
    expect(complete).toBe(true);
    const out = rebaseEdits(b, edits).doc;
    const [o1, o2, o3] = sets(out);
    expect(o1).toMatchObject({ actualWeightKg: 47, actualReps: 9 });
    expect(o2!.completedAt).not.toBeNull();
    expect(o3!.completedAt).toBeNull();
    expect(out.notes).toBe('Good session');
    expect(exercises(out)[0]!.note).toBe('Knees out');
  });

  it('two tabs: tab A lost its save (base 5, draft 9); tab B moved the server on to 8. Both keep their sets', () => {
    const b = base();
    const [s1, s2] = sets(b);
    // Tab A, never saved: 47 kg on set 1.
    const draftA = { ...updateActual(b, s1!.id, { actualWeightKg: 47 }), revision: 9 };
    // Tab B, saved: set 2 ticked with 12 reps (server at 8).
    const server = { ...updateActual(completeSet(b, s2!.id, T2), s2!.id, { actualReps: 12 }), revision: 8 };
    const { edits, complete } = draftEdits(b, draftA);
    expect(complete).toBe(true);
    const out = rebaseEdits(server, edits);
    const [o1, o2] = sets(out.doc);
    expect(o1!.actualWeightKg).toBe(47);
    expect(o2!.completedAt).not.toBeNull();
    expect(o2!.actualReps).toBe(12);
    expect(out.doc.revision).toBe(9);
    expect(out.unsaved).toHaveLength(1);
  });

  it('a field both changed: the device copy wins only on the field it changed', () => {
    const b = base();
    const s1 = sets(b)[0]!;
    const draft = updateActual(b, s1.id, { actualWeightKg: 47 });
    const server = { ...updateActual(b, s1.id, { actualWeightKg: 50, actualReps: 8 }), revision: 7 };
    const out = rebaseEdits(server, draftEdits(b, draft).edits).doc;
    expect(sets(out)[0]).toMatchObject({ actualWeightKg: 47, actualReps: 8 });
  });

  it('edits already on the server change nothing (no extra revision)', () => {
    const b = base();
    const s1 = sets(b)[0]!;
    const draft = completeSet(updateActual(b, s1.id, { actualWeightKg: 47 }), s1.id, T1);
    const server = { ...draft, revision: 8 };
    const out = rebaseEdits(server, draftEdits(b, draft).edits);
    expect(out.doc).toBe(server);
    expect(out.unsaved).toEqual([]);
  });

  it('changes it cannot redo (an added set) are left out and reported, the rest still come back', () => {
    const b = base();
    const ex = exercises(b)[0]!;
    const withSet = addLogSet(b, ex.id, uuid, T1);
    const draft = updateActual(withSet, sets(b)[0]!.id, { actualReps: 11 });
    const { edits, complete } = draftEdits(b, draft);
    expect(complete).toBe(false);
    expect(sets(rebaseEdits(b, edits).doc)[0]!.actualReps).toBe(11);
  });
});
