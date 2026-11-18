import { describe, expect, it } from 'vitest';
import { draftConflicts, draftEdits } from '../../src/logs/draft-edits';
import { addLogSet, completeSet, setExerciseNote, setLogNotes, uncompleteSet, updateActual } from '../../src/logs/ops';
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
    const fresh = base();
    const b = { ...completeSet(fresh, sets(fresh)[2]!.id, T0), revision: 5 };
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

  it('a field changed on the server since: the newer server value stays, and it is reported (A 100 over base 80, B saved 110)', () => {
    const fresh = base();
    const b = { ...updateActual(fresh, sets(fresh)[0]!.id, { actualWeightKg: 80 }), revision: 5 };
    const s1 = sets(b)[0]!;
    const draft = updateActual(b, s1.id, { actualWeightKg: 100 });
    const server = { ...updateActual(b, s1.id, { actualWeightKg: 110 }), revision: 7 };
    const { edits } = draftEdits(b, draft);
    expect(draftConflicts(b, draft, server)).toBe(true);
    expect(sets(rebaseEdits(server, edits).doc)[0]!.actualWeightKg).toBe(110);
  });

  it('only the fields it changed: a field the server changed and the copy did not is left as the server has it', () => {
    const b = base();
    const s1 = sets(b)[0]!;
    const draft = updateActual(b, s1.id, { actualWeightKg: 47 });
    const server = { ...updateActual(b, s1.id, { actualReps: 8 }), revision: 7 };
    expect(draftConflicts(b, draft, server)).toBe(false);
    expect(sets(rebaseEdits(server, draftEdits(b, draft).edits).doc)[0]).toMatchObject({ actualWeightKg: 47, actualReps: 8 });
  });

  it('an untick does not undo a tick made on the server since; a tick does not redo one the server undid', () => {
    const fresh = base();
    const ticked = { ...completeSet(fresh, sets(fresh)[0]!.id, T0), revision: 5 };
    const s1 = sets(ticked)[0]!;
    // Base ticked; the copy unticked; the server unticked then ticked again later (its tick time is newer).
    const unticked = uncompleteSet(ticked, s1.id, T1);
    const retickedOnServer = { ...completeSet(uncompleteSet(ticked, s1.id, T1), s1.id, T2), revision: 8 };
    expect(draftConflicts(ticked, unticked, retickedOnServer)).toBe(true);
    expect(sets(rebaseEdits(retickedOnServer, draftEdits(ticked, unticked).edits).doc)[0]!.completedAt).toBe(T2);
  });

  it('a session note changed on the server since is kept, not replaced', () => {
    const b = { ...setLogNotes(base(), 'Start', T0), revision: 5 };
    const draft = setLogNotes(b, 'From the device', T1);
    const server = { ...setLogNotes(b, 'From the other tab', T2), revision: 6 };
    expect(draftConflicts(b, draft, server)).toBe(true);
    expect(rebaseEdits(server, draftEdits(b, draft).edits).doc.notes).toBe('From the other tab');
  });

  it('an exercise note changed on the server since is kept', () => {
    const b = base();
    const ex = exercises(b)[0]!;
    const draft = setExerciseNote(b, ex.id, 'Mine', T1);
    const server = { ...setExerciseNote(b, ex.id, 'Theirs', T2), revision: 6 };
    expect(draftConflicts(b, draft, server)).toBe(true);
    expect(exercises(rebaseEdits(server, draftEdits(b, draft).edits).doc)[0]!.note).toBe('Theirs');
  });

  it('a set whose exercise was swapped on the server since is left alone', () => {
    const b = base();
    const s1 = sets(b)[0]!;
    const draft = updateActual(b, s1.id, { actualWeightKg: 47 });
    const swapped = {
      ...b,
      revision: 7,
      blocks: b.blocks.map((bl, i) => (i === 0 ? { ...bl, exercises: bl.exercises.map((e, j) => (j === 0 ? { ...e, exerciseId: uuid() } : e)) } : bl)),
    };
    expect(draftConflicts(b, draft, swapped)).toBe(true);
    expect(sets(rebaseEdits(swapped, draftEdits(b, draft).edits).doc)[0]!.actualWeightKg).toBeNull();
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
