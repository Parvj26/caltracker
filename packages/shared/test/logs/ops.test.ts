import { describe, expect, it } from 'vitest';
import {
  addLogDrop,
  addLogExercise,
  addLogSet,
  completeSet,
  completeSetWith,
  dropParentId,
  removeLogExercise,
  removeLogSet,
  setExerciseNote,
  setLogNotes,
  stepActual,
  swapLogExercise,
  uncompleteSet,
  updateActual,
} from '../../src/logs/ops';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-05T10:00:00.000Z';
const T1 = '2026-11-05T10:05:00.000Z';
const T2 = '2026-11-05T10:10:00.000Z';

let counter = 5000;
const makeId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};

const pick = (trackingType: ExercisePick['trackingType'] = 'weight_reps'): ExercisePick => ({
  id: uuid(),
  name: 'Swapped',
  trackingType,
});

const fresh = () => deepFreeze(startLogFromWorkout(fixtureWorkout(), uuid, T0));
const straight = (log: WorkoutLogDoc) => log.blocks[0]!.exercises[0]!;

describe('log ops', () => {
  it('completeSet then uncompleteSet round-trips and bumps revision by 2', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    const done = completeSet(log, id, T1);
    expect(straight(done).sets[1]!.completedAt).toBe(T1);
    expect(done.lastActivityAt).toBe(T1);
    const undone = uncompleteSet(done, id, T2);
    expect(straight(undone).sets[1]!.completedAt).toBeNull();
    expect(undone.revision).toBe(log.revision + 2);
    expect(undone.lastActivityAt).toBe(T2);
  });

  it('updateActual bumps revision only', () => {
    const log = fresh();
    const out = updateActual(log, straight(log).sets[1]!.id, { actualReps: 12, actualWeightKg: 62.5 });
    expect(straight(out).sets[1]).toMatchObject({ actualReps: 12, actualWeightKg: 62.5 });
    expect(out.revision).toBe(log.revision + 1);
    expect(out.lastActivityAt).toBe(log.lastActivityAt);
  });

  it('addLogSet copies the target, not the actuals', () => {
    const log = fresh();
    const out = addLogSet(log, straight(log).id, makeId, T1);
    const sets = straight(out).sets;
    const lastNormal = straight(log).sets[3]!;
    const added = sets[sets.length - 1]!;
    expect(sets).toHaveLength(6);
    expect(added).toMatchObject({
      setType: 'normal',
      target: lastNormal.target,
      actualReps: null,
      actualWeightKg: null,
      actualDurationS: null,
      actualDistanceM: null,
      completedAt: null,
    });
    expect(added.id).not.toBe(lastNormal.id);
  });

  it('completeSetWith fills empty actuals and completes', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    const out = completeSetWith(log, id, { reps: 10, weightKg: 60, durationS: null, distanceM: null }, T1);
    const s = straight(out).sets[1]!;
    expect([s.actualReps, s.actualWeightKg, s.completedAt]).toEqual([10, 60, T1]);
    expect(out.revision).toBe(log.revision + 1);
    expect(out.lastActivityAt).toBe(T1);
  });

  it('completeSetWith keeps a typed value', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    const typed = updateActual(log, id, { actualWeightKg: 55 });
    const out = completeSetWith(typed, id, { reps: 10, weightKg: 60, durationS: null, distanceM: null }, T1);
    const s = straight(out).sets[1]!;
    expect([s.actualReps, s.actualWeightKg]).toEqual([10, 55]);
  });

  it('completeSetWith refuses an already completed set and an unknown set', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    const done = completeSet(log, id, T1);
    const v = { reps: 1, weightKg: 1, durationS: null, distanceM: null };
    expect(completeSetWith(done, id, v, T2)).toBe(done);
    expect(completeSetWith(log, uuid(), v, T1)).toBe(log);
  });

  it('addLogDrop twice after set 2 orders [n1, n2, d, d, n3]', () => {
    const log = fresh();
    const ex = straight(log);
    const n2 = ex.sets[2]!.id;
    const once = addLogDrop(log, ex.id, n2, makeId, T1);
    const twice = addLogDrop(once, ex.id, n2, makeId, T2);
    const types = straight(twice).sets.map((s) => s.setType);
    expect(types).toEqual(['warmup', 'normal', 'normal', 'drop', 'drop', 'normal', 'drop']);
    const drop = straight(twice).sets[3]!;
    expect(drop.target).toMatchObject({ restSeconds: 0, repsMin: null, weightKg: null });
    expect(drop).toMatchObject({ actualReps: null, actualWeightKg: null, completedAt: null });
    expect(twice.revision).toBe(2);
  });

  it('removeLogSet removes a middle set and a parent with its drops', () => {
    const log = fresh();
    const ex = straight(log);
    const withDrop = addLogDrop(log, ex.id, ex.sets[2]!.id, makeId, T1);
    const out = removeLogSet(withDrop, ex.id, ex.sets[2]!.id, T2);
    expect(straight(out).sets.map((s) => s.id)).toEqual([
      ex.sets[0]!.id,
      ex.sets[1]!.id,
      ex.sets[3]!.id,
      ex.sets[4]!.id,
    ]);
    const second = log.blocks[1]!.exercises[0]!;
    const two = removeLogSet(log, second.id, second.sets[1]!.id, T1);
    expect(two.blocks[1]!.exercises[0]!.sets.map((s) => s.id)).toEqual([second.sets[0]!.id, second.sets[2]!.id]);
  });

  it('removeLogSet is a no-op for the last non-drop set', () => {
    let log = fresh();
    const second = log.blocks[1]!.exercises[0]!;
    log = removeLogSet(log, second.id, second.sets[0]!.id, T1);
    log = removeLogSet(log, second.id, log.blocks[1]!.exercises[0]!.sets[0]!.id, T1);
    const left = log.blocks[1]!.exercises[0]!.sets;
    expect(left).toHaveLength(1);
    const same = removeLogSet(log, second.id, left[0]!.id, T2);
    expect(same).toBe(log);
  });

  it('swapLogExercise to time nulls weight and reps, keeps the original swap source and completion', () => {
    const base = fresh();
    const log = completeSet(base, straight(base).sets[1]!.id, T1);
    const ex = straight(log);
    const first = swapLogExercise(log, ex.id, pick('time'), T2);
    const e1 = straight(first);
    expect(e1.swappedFromExerciseId).toBe(ex.exerciseId);
    expect(e1.trackingType).toBe('time');
    expect(e1.exerciseName).toBe('Swapped');
    for (const s of e1.sets) {
      expect(s.target).toMatchObject({ repsMin: null, repsMax: null, weightKg: null });
      expect(s).toMatchObject({ actualReps: null, actualWeightKg: null });
    }
    expect(e1.sets[1]!.completedAt).toBe(T1);
    const second = swapLogExercise(first, ex.id, pick('weight_reps'), T2);
    expect(straight(second).swappedFromExerciseId).toBe(ex.exerciseId);
  });

  it('addLogExercise appends a straight block of 3 empty normal sets', () => {
    const log = fresh();
    const out = addLogExercise(log, pick(), makeId, T1);
    expect(out.blocks).toHaveLength(3);
    const ex = out.blocks[2]!.exercises[0]!;
    expect(out.blocks[2]!.kind).toBe('straight');
    expect(ex.plannedWorkoutExerciseId).toBeNull();
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets.every((s) => s.setType === 'normal' && s.actualReps === null && s.target.repsMin === null)).toBe(
      true,
    );
  });

  it('removeLogExercise turns a 2-exercise superset straight and drops empty blocks', () => {
    const log = fresh();
    const ss = log.blocks[1]!;
    const out = removeLogExercise(log, ss.exercises[0]!.id, T1);
    expect(out.blocks[1]!.kind).toBe('straight');
    expect(out.blocks[1]!.exercises).toHaveLength(1);
    const gone = removeLogExercise(out, ss.exercises[1]!.id, T2);
    expect(gone.blocks).toHaveLength(1);
  });

  it('setExerciseNote sets and clears a note', () => {
    const log = fresh();
    const out = setExerciseNote(log, straight(log).id, 'Shoulder tight', T1);
    expect(straight(out).note).toBe('Shoulder tight');
    expect(straight(setExerciseNote(out, straight(log).id, null, T2)).note).toBeNull();
  });

  it('unknown ids return the doc unchanged', () => {
    const log = fresh();
    const bad = uuid();
    const exId = straight(log).id;
    expect(completeSet(log, bad, T1)).toBe(log);
    expect(uncompleteSet(log, bad, T1)).toBe(log);
    expect(updateActual(log, bad, { actualReps: 1 })).toBe(log);
    expect(addLogSet(log, bad, makeId, T1)).toBe(log);
    expect(addLogDrop(log, bad, bad, makeId, T1)).toBe(log);
    expect(addLogDrop(log, exId, bad, makeId, T1)).toBe(log);
    expect(removeLogSet(log, exId, bad, T1)).toBe(log);
    expect(swapLogExercise(log, bad, pick(), T1)).toBe(log);
    expect(removeLogExercise(log, bad, T1)).toBe(log);
    expect(setExerciseNote(log, bad, 'x', T1)).toBe(log);
  });

  it('never mutates input and always yields a valid doc', () => {
    const log = fresh();
    const ex = straight(log);
    const outputs = [
      completeSet(log, ex.sets[1]!.id, T1),
      uncompleteSet(log, ex.sets[1]!.id, T1),
      updateActual(log, ex.sets[1]!.id, { actualDistanceM: 3 }),
      addLogSet(log, ex.id, makeId, T1),
      addLogDrop(log, ex.id, ex.sets[1]!.id, makeId, T1),
      removeLogSet(log, ex.id, ex.sets[2]!.id, T1),
      swapLogExercise(log, ex.id, pick('distance'), T1),
      addLogExercise(log, pick(), makeId, T1),
      removeLogExercise(log, log.blocks[1]!.exercises[0]!.id, T1),
      setExerciseNote(log, ex.id, 'n', T1),
      setLogNotes(log, 'Felt: Good\nnote', T1),
      setLogNotes(log, 'z'.repeat(2500), T1),
    ];
    for (const o of outputs) expect(WorkoutLogDoc.safeParse(o).success).toBe(true);
  });
});

describe('dropParentId', () => {
  it('is the set itself for a warm-up or working set', () => {
    const ex = straight(fresh());
    expect(dropParentId(ex, 0)).toBe(ex.sets[0]!.id);
    expect(dropParentId(ex, 3)).toBe(ex.sets[3]!.id);
  });

  it('walks up from a drop (or a later drop) to its main set', () => {
    const log = fresh();
    const ex = straight(log);
    expect(dropParentId(ex, 4)).toBe(ex.sets[3]!.id);
    const twice = straight(addLogDrop(log, ex.id, ex.sets[3]!.id, makeId, T1));
    expect(dropParentId(twice, 5)).toBe(twice.sets[3]!.id);
  });

  it('is null for an index that is not there', () => {
    expect(dropParentId(straight(fresh()), 9)).toBeNull();
  });
});

describe('stepActual', () => {
  it('steps from the stored value, so fast presses all count', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    // Two presses queued from the same screen (both saw 8 reps shown, nothing stored yet).
    const once = stepActual(log, id, 'reps', 1, 'kg', 8);
    const twice = stepActual(once, id, 'reps', 1, 'kg', 8);
    expect(straight(once).sets[1]!.actualReps).toBe(9);
    expect(straight(twice).sets[1]!.actualReps).toBe(10);
  });

  it('starts from the shown pre-fill when nothing is stored', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    const out = stepActual(log, id, 'weight', -1, 'kg', 60);
    expect(straight(out).sets[1]!.actualWeightKg).toBe(57.5);
    expect(out.revision).toBe(log.revision + 1);
  });

  it('leaves the log alone when the press changes nothing or the set is gone', () => {
    const log = fresh();
    const id = straight(log).sets[1]!.id;
    expect(stepActual(log, id, 'reps', -1, 'kg', null)).toBe(log);
    expect(stepActual(log, 'missing', 'reps', 1, 'kg', 8)).toBe(log);
  });
});
