import { completeSet, setExerciseNote, setLogNotes, uncompleteSet, updateActual, type ActualPatch } from './ops';
import type { LogEdit } from './rebase';
import type { LogExerciseDoc, LogSetDoc, WorkoutLogDoc } from './schema';

const ACTUALS = ['actualReps', 'actualWeightKg', 'actualDurationS', 'actualDistanceM'] as const;

function setsById(log: WorkoutLogDoc): Map<string, LogSetDoc> {
  return new Map(log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets.map((s) => [s.id, s] as const))));
}

function exercisesById(log: WorkoutLogDoc): Map<string, LogExerciseDoc> {
  return new Map(log.blocks.flatMap((b) => b.exercises.map((e) => [e.id, e] as const)));
}

/** The log's shape: blocks, picks, exercises (and what is done for each) and their sets, in order. */
function shape(log: WorkoutLogDoc): string {
  return JSON.stringify(
    log.blocks.map((b) => [b.id, b.pickedExerciseId, b.exercises.map((e) => [e.id, e.exerciseId, e.substituteId, e.sets.map((s) => [s.id, s.setType])])]),
  );
}

/**
 * What `draft` (a device's copy of a log) changed since `base` (the server copy it grew from), as log edits that
 * redo each change on any other copy: typed numbers, ticks and unticks, the session note and exercise notes. Each
 * edit changes only the fields the device changed, and nothing when the other copy already has them, so with
 * rebaseEdits it merges a device copy whose save was lost onto a server copy that moved on meanwhile (another tab).
 * Changes of shape (sets or exercises added, removed or swapped, a pick) can't be redone safely this way: they are
 * left out and `complete` is false. Pure.
 */
export function draftEdits(base: WorkoutLogDoc, draft: WorkoutLogDoc): { edits: LogEdit[]; complete: boolean } {
  const edits: LogEdit[] = [];
  const at = draft.lastActivityAt;
  const before = setsById(base);
  for (const set of setsById(draft).values()) {
    const old = before.get(set.id);
    if (!old) continue;
    const patch: ActualPatch = {};
    for (const k of ACTUALS) if (set[k] !== old[k]) patch[k] = set[k];
    const fields = Object.keys(patch) as (keyof ActualPatch)[];
    if (fields.length > 0) {
      edits.push((l) => {
        const now = setsById(l).get(set.id);
        if (!now || fields.every((k) => now[k] === patch[k])) return l;
        return updateActual(l, set.id, patch);
      });
    }
    if ((set.completedAt === null) !== (old.completedAt === null)) {
      const tick = set.completedAt;
      edits.push((l) => {
        const now = setsById(l).get(set.id);
        if (!now || (now.completedAt === null) === (tick === null)) return l;
        return tick ? completeSet(l, set.id, tick) : uncompleteSet(l, set.id, at);
      });
    }
  }
  const oldExercises = exercisesById(base);
  for (const ex of exercisesById(draft).values()) {
    const old = oldExercises.get(ex.id);
    if (!old || old.note === ex.note) continue;
    edits.push((l) => {
      const now = exercisesById(l).get(ex.id);
      return !now || now.note === ex.note ? l : setExerciseNote(l, ex.id, ex.note, at);
    });
  }
  if (draft.notes !== base.notes) edits.push((l) => setLogNotes(l, draft.notes, at));
  return { edits, complete: shape(draft) === shape(base) };
}
