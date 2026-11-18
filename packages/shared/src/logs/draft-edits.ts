import { completeSet, setExerciseNote, setLogNotes, uncompleteSet, updateActual } from './ops';
import type { LogEdit } from './rebase';
import type { LogExerciseDoc, LogSetDoc, WorkoutLogDoc } from './schema';

const ACTUALS = ['actualReps', 'actualWeightKg', 'actualDurationS', 'actualDistanceM'] as const;

type Found = { set: LogSetDoc; exercise: LogExerciseDoc };

function setsById(log: WorkoutLogDoc): Map<string, Found> {
  return new Map(log.blocks.flatMap((b) => b.exercises.flatMap((exercise) => exercise.sets.map((set) => [set.id, { set, exercise }] as const))));
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

const sameExercise = (a: LogExerciseDoc, b: LogExerciseDoc) => a.exerciseId === b.exerciseId && a.substituteId === b.substituteId;

/**
 * One change a device copy made: on another copy it is `apply` (that copy still has the old value), `same` (it has
 * the new one already, or the thing is gone) or `conflict` (it has a third value: changed there since, so it stays).
 */
type Change = { state: (l: WorkoutLogDoc) => 'apply' | 'same' | 'conflict'; apply: LogEdit };

function changes(base: WorkoutLogDoc, draft: WorkoutLogDoc): Change[] {
  const out: Change[] = [];
  const at = draft.lastActivityAt;
  const before = setsById(base);
  for (const { set, exercise } of setsById(draft).values()) {
    const old = before.get(set.id);
    if (!old || !sameExercise(old.exercise, exercise)) continue;
    /** The set on `l`, or null when it is gone or now belongs to another exercise (swapped, substituted). */
    const on = (l: WorkoutLogDoc) => {
      const now = setsById(l).get(set.id);
      return now && sameExercise(now.exercise, old.exercise) ? now.set : null;
    };
    for (const k of ACTUALS) {
      if (set[k] === old.set[k]) continue;
      out.push({
        state: (l) => {
          const now = on(l);
          if (!now) return set[k] === old.set[k] ? 'same' : setsById(l).has(set.id) ? 'conflict' : 'same';
          return now[k] === set[k] ? 'same' : now[k] === old.set[k] ? 'apply' : 'conflict';
        },
        apply: (l) => updateActual(l, set.id, { [k]: set[k] }),
      });
    }
    if (set.completedAt !== old.set.completedAt) {
      const was = old.set.completedAt;
      const tick = set.completedAt;
      out.push({
        state: (l) => {
          const now = on(l);
          if (!now) return setsById(l).has(set.id) ? 'conflict' : 'same';
          if ((now.completedAt === null) === (tick === null) && (tick === null || now.completedAt === tick)) return 'same';
          return now.completedAt === was ? 'apply' : 'conflict';
        },
        apply: (l) => (tick ? completeSet(l, set.id, tick) : uncompleteSet(l, set.id, at)),
      });
    }
  }
  const oldExercises = exercisesById(base);
  for (const ex of exercisesById(draft).values()) {
    const old = oldExercises.get(ex.id);
    if (!old || old.note === ex.note) continue;
    out.push({
      state: (l) => {
        const now = exercisesById(l).get(ex.id);
        return !now || now.note === ex.note ? 'same' : now.note === old.note ? 'apply' : 'conflict';
      },
      apply: (l) => setExerciseNote(l, ex.id, ex.note, at),
    });
  }
  if (draft.notes !== base.notes) {
    out.push({
      state: (l) => (l.notes === draft.notes ? 'same' : l.notes === base.notes ? 'apply' : 'conflict'),
      apply: (l) => setLogNotes(l, draft.notes, at),
    });
  }
  return out;
}

/**
 * What `draft` (a device's copy of a log) changed since `base` (the server copy it grew from), as log edits that
 * redo each change on any other copy: typed numbers, ticks and unticks, the session note and exercise notes. An edit
 * applies only where that copy still has the base value, so with rebaseEdits a device copy whose save was lost
 * merges onto a server copy that moved on (another tab) without overwriting anything changed there since; sets of an
 * exercise swapped since are left alone (draftConflicts says when anything was held back). Changes of shape (sets
 * or exercises added, removed or swapped, a pick) can't be redone this way: they are left out and `complete` is
 * false. Pure.
 */
export function draftEdits(base: WorkoutLogDoc, draft: WorkoutLogDoc): { edits: LogEdit[]; complete: boolean } {
  const edits = changes(base, draft).map((c): LogEdit => (l) => (c.state(l) === 'apply' ? c.apply(l) : l));
  return { edits, complete: shape(draft) === shape(base) };
}

/** True when some of `draft`'s changes would be held back on `onto`, because it changed the same thing since. */
export function draftConflicts(base: WorkoutLogDoc, draft: WorkoutLogDoc, onto: WorkoutLogDoc): boolean {
  return changes(base, draft).some((c) => c.state(onto) === 'conflict');
}
