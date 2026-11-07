import { describe, expect, it } from 'vitest';
import {
  afterDone,
  blockRoundCount,
  blockSteps,
  currentStep,
  isBlockDone,
  isChoiceLocked,
  liveExercises,
  needsPick,
  nextOpenBlock,
  roundRestSeconds,
} from '../../src/logs/flow';
import {
  addLogDrop,
  addLogExercise,
  addLogSet,
  completeSet,
  completeSetWith,
  discardLog,
  finishLog,
  pickChoice,
  removeLogExercise,
  removeLogSet,
  reopenLog,
  setExerciseNote,
  setLogNotes,
  stepActual,
  swapLogExercise,
  updateActual,
  toggleSet,
  uncompleteSet,
} from '../../src/logs/ops';
import * as ops from '../../src/logs/ops';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import { autoFinish, completedSetCount, logVolumeKg, openSetCount } from '../../src/logs/summary';
import { addChoice, addSection, addStraightBlock, emptyWorkout } from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';
import { uuid } from './fixture';

const NOW = '2026-11-06T10:00:00.000Z';
const LATER = '2026-11-06T10:05:00.000Z';
const pick = (name: string): ExercisePick => ({ id: uuid(), name, trackingType: 'weight_reps' });

/** Resistance [Squat], Finisher [pick one: Farmer's Walk / Medicine Ball Slam / Burpee]. */
function build(): WorkoutLogDoc {
  let d = emptyWorkout(uuid, 'Upper / Core');
  d = addSection(d, 'Resistance', uuid);
  d = addStraightBlock(d, pick('Squat'), uuid);
  d = addSection(d, 'Finisher', uuid);
  d = addChoice(d, [pick("Farmer's Walk"), pick('Medicine Ball Slam'), pick('Burpee')], uuid);
  return startLogFromWorkout(WorkoutDoc.parse(d), uuid, NOW);
}
const choiceIdx = 1;
const optionSets = (log: WorkoutLogDoc, ei: number) => log.blocks[choiceIdx]!.exercises[ei]!.sets.map((s) => s.id);
const optionId = (log: WorkoutLogDoc, ei: number) => log.blocks[choiceIdx]!.exercises[ei]!.id;
const blockId = (log: WorkoutLogDoc) => log.blocks[choiceIdx]!.id;
const picked = (log: WorkoutLogDoc, ei: number) => pickChoice(log, blockId(log), optionId(log, ei), NOW);

describe('needsPick / liveExercises / isChoiceLocked', () => {
  it('an unpicked group needs a pick and has no live exercises', () => {
    const b = build().blocks[choiceIdx]!;
    expect(needsPick(b)).toBe(true);
    expect(liveExercises(b)).toEqual([]);
    expect(isChoiceLocked(b)).toBe(false);
  });
  it('a picked group has only the picked exercise, with its original index', () => {
    const log = picked(build(), 1);
    const b = log.blocks[choiceIdx]!;
    expect(needsPick(b)).toBe(false);
    expect(liveExercises(b).map((l) => l.exerciseIndex)).toEqual([1]);
    expect(liveExercises(b)[0]!.exercise.id).toBe(optionId(log, 1));
  });
  it('other blocks are fully live and never need a pick', () => {
    const b = build().blocks[0]!;
    expect(needsPick(b)).toBe(false);
    expect(liveExercises(b)).toHaveLength(1);
    expect(isChoiceLocked(b)).toBe(false);
  });
  it('locks once the picked option has a done set', () => {
    let log = picked(build(), 1);
    expect(isChoiceLocked(log.blocks[choiceIdx]!)).toBe(false);
    log = completeSet(log, optionSets(log, 1)[0]!, LATER);
    expect(isChoiceLocked(log.blocks[choiceIdx]!)).toBe(true);
  });
});

describe('flow over a choice block', () => {
  it('steps, current step, rounds and rest use only the picked option, with original indexes', () => {
    const log = picked(build(), 1);
    const b = log.blocks[choiceIdx]!;
    const steps = blockSteps(b);
    expect(steps.map((s) => s.setId)).toEqual(optionSets(log, 1));
    expect(steps.every((s) => s.exerciseIndex === 1)).toBe(true);
    expect(currentStep(b)?.setId).toBe(optionSets(log, 1)[0]);
    expect(blockRoundCount(b)).toBe(3);
    expect(roundRestSeconds(b, 1)).toBe(90);
  });
  it('an unpicked group has no steps and no current step', () => {
    const b = build().blocks[choiceIdx]!;
    expect(blockSteps(b)).toEqual([]);
    expect(currentStep(b)).toBeNull();
    expect(blockRoundCount(b)).toBe(0);
  });
  it('isBlockDone is false while unpicked and true once every picked set is done', () => {
    let log = build();
    expect(isBlockDone(log.blocks[choiceIdx]!)).toBe(false);
    log = picked(log, 0);
    expect(isBlockDone(log.blocks[choiceIdx]!)).toBe(false);
    for (const id of optionSets(log, 0)) log = completeSet(log, id, LATER);
    expect(isBlockDone(log.blocks[choiceIdx]!)).toBe(true);
  });
  it('nextOpenBlock treats an unpicked group as open', () => {
    let log = build();
    for (const s of log.blocks[0]!.exercises[0]!.sets) log = completeSet(log, s.id, LATER);
    expect(nextOpenBlock(log, 0)).toBe(choiceIdx);
  });
  it('afterDone on the last Resistance set is not "last" while the finisher is unpicked', () => {
    let log = build();
    const sets = log.blocks[0]!.exercises[0]!.sets.map((s) => s.id);
    for (const id of sets.slice(0, 2)) log = completeSet(log, id, LATER);
    const after = afterDone(log, 0, sets[2]!);
    expect(after.kind).not.toBe('last');
  });
  it('once picked, the last picked set is "last" and unpicked options never count', () => {
    let log = picked(build(), 1);
    for (const s of log.blocks[0]!.exercises[0]!.sets) log = completeSet(log, s.id, LATER);
    const sets = optionSets(log, 1);
    for (const id of sets.slice(0, 2)) log = completeSet(log, id, LATER);
    expect(afterDone(log, choiceIdx, sets[2]!)).toEqual({ kind: 'last' });
  });
});

describe('pickChoice', () => {
  it('sets the pick, bumps revision and activity', () => {
    const log = build();
    const r = pickChoice(log, blockId(log), optionId(log, 2), LATER);
    expect(r.blocks[choiceIdx]!.pickedExerciseId).toBe(optionId(log, 2));
    expect(r.revision).toBe(log.revision + 1);
    expect(r.lastActivityAt).toBe(LATER);
  });
  it('clearing returns to needsPick when unlocked', () => {
    const log = picked(build(), 0);
    const r = pickChoice(log, blockId(log), null, LATER);
    expect(needsPick(r.blocks[choiceIdx]!)).toBe(true);
  });
  it('refuses a straight block, an unknown id and an id from another block', () => {
    const log = build();
    expect(pickChoice(log, log.blocks[0]!.id, log.blocks[0]!.exercises[0]!.id, LATER)).toBe(log);
    expect(pickChoice(log, blockId(log), uuid(), LATER)).toBe(log);
    expect(pickChoice(log, blockId(log), log.blocks[0]!.exercises[0]!.id, LATER)).toBe(log);
    expect(pickChoice(log, uuid(), optionId(log, 0), LATER)).toBe(log);
  });
  it('the same pick again changes nothing', () => {
    const log = picked(build(), 0);
    expect(picked(log, 0)).toBe(log);
  });
  it('locked: another option or a clear is refused; undoing the set frees it', () => {
    let log = picked(build(), 0);
    const first = optionSets(log, 0)[0]!;
    log = completeSet(log, first, LATER);
    expect(picked(log, 1)).toBe(log);
    expect(pickChoice(log, blockId(log), null, LATER)).toBe(log);
    expect(picked(log, 0)).toBe(log);
    log = uncompleteSet(log, first, LATER);
    const swapped = picked(log, 1);
    expect(swapped.blocks[choiceIdx]!.pickedExerciseId).toBe(optionId(log, 1));
    expect(swapped.blocks[choiceIdx]!.exercises[0]!.sets.every((s) => s.completedAt === null)).toBe(true);
  });
});

describe('sets of an unpicked option', () => {
  it('completeSet, completeSetWith and toggleSet refuse', () => {
    const log = picked(build(), 1);
    const other = optionSets(log, 0)[0]!;
    expect(completeSet(log, other, LATER)).toBe(log);
    const values = { reps: 10, weightKg: 20, durationS: null, distanceM: null };
    expect(completeSetWith(log, other, values, LATER)).toBe(log);
    const t = toggleSet(log, other, LATER);
    expect(t.log).toBe(log);
    expect(t.completed).toBeNull();
    const unpicked = build();
    expect(completeSet(unpicked, optionSets(unpicked, 0)[0]!, LATER)).toBe(unpicked);
  });
  it('the picked option still completes', () => {
    const log = picked(build(), 1);
    const r = completeSet(log, optionSets(log, 1)[0]!, LATER);
    expect(r).not.toBe(log);
    expect(toggleSet(log, optionSets(log, 1)[0]!, LATER).completed).toBe(true);
  });
});

describe('add and remove', () => {
  it('addLogExercise adds an unsectioned straight block with no pick', () => {
    const r = addLogExercise(build(), pick('Row'), uuid, LATER);
    const b = r.blocks[r.blocks.length - 1]!;
    expect(b.sectionId).toBeNull();
    expect(b.pickedExerciseId).toBeNull();
    expect(b.kind).toBe('straight');
  });
  it('removing any option removes the whole group', () => {
    const log = picked(build(), 1);
    for (const ei of [0, 1, 2]) {
      const r = removeLogExercise(log, optionId(log, ei), LATER);
      expect(r.blocks).toHaveLength(1);
      expect(r.blocks[0]!.id).toBe(log.blocks[0]!.id);
    }
  });
});

describe('counts', () => {
  it('openSetCount: finisher unpicked counts its first option\'s 3 normal sets', () => {
    let log = build();
    expect(openSetCount(log)).toBe(6);
    for (const s of log.blocks[0]!.exercises[0]!.sets) log = completeSet(log, s.id, LATER);
    expect(openSetCount(log)).toBe(3);
  });
  it('openSetCount counts only the picked option once picked', () => {
    let log = picked(build(), 2);
    log = completeSet(log, optionSets(log, 2)[0]!, LATER);
    expect(openSetCount(log)).toBe(3 + 2);
  });
  it('logVolumeKg counts only the picked option (3 x 12 x 15 lb)', () => {
    let log = picked(build(), 1);
    const lb15 = 15 * 0.45359237;
    for (const id of optionSets(log, 1)) {
      log = completeSetWith(log, id, { reps: 12, weightKg: lb15, durationS: null, distanceM: null }, LATER);
    }
    expect(completedSetCount(log)).toBe(3);
    expect(logVolumeKg(log)).toBe(Math.round(3 * 12 * lb15 * 10) / 10);
  });
});

describe('every op keeps a choice-containing log valid (the phone drops a log that fails to parse)', () => {
  const T = LATER;
  // Each op's name is recorded as it is exercised, so the guard test below can prove none was forgotten.
  const exercised = new Set<string>();
  const ok = (l: WorkoutLogDoc, op?: string) => {
    if (op) exercised.add(op);
    expect(WorkoutLogDoc.safeParse(l).success).toBe(true);
  };
  const values = { reps: 10, weightKg: 20, durationS: null, distanceM: null };

  it('on unpicked, picked and locked logs, for every set and option', () => {
    const unpicked = build();
    const pickedLog = picked(build(), 1);
    const locked = completeSet(pickedLog, optionSets(pickedLog, 1)[0]!, T);
    for (const log of [unpicked, pickedLog, locked]) {
      ok(log);
      const allSets = log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets.map((s) => s.id)));
      for (const id of allSets) {
        ok(completeSet(log, id, T), 'completeSet');
        ok(completeSetWith(log, id, values, T), 'completeSetWith');
        ok(toggleSet(log, id, T).log, 'toggleSet');
        ok(uncompleteSet(log, id, T), 'uncompleteSet');
        ok(updateActual(log, id, { actualReps: 5 }), 'updateActual');
        for (const f of ['weight', 'reps'] as const) ok(stepActual(log, id, f, 1, 'kg', 10), 'stepActual');
      }
      for (const b of log.blocks) {
        for (const e of b.exercises) {
          ok(removeLogExercise(log, e.id, T), 'removeLogExercise');
          ok(addLogSet(log, e.id, uuid, T), 'addLogSet');
          ok(addLogDrop(log, e.id, e.sets[0]!.id, uuid, T), 'addLogDrop');
          ok(swapLogExercise(log, e.id, pick('Swapped'), T), 'swapLogExercise');
          ok(removeLogSet(log, e.id, e.sets[0]!.id, T), 'removeLogSet');
          ok(setExerciseNote(log, e.id, 'n', T), 'setExerciseNote');
          ok(pickChoice(log, b.id, e.id, T), 'pickChoice');
        }
        ok(pickChoice(log, b.id, null, T), 'pickChoice');
      }
      ok(addLogExercise(log, pick('Row'), uuid, T), 'addLogExercise');
      ok(setLogNotes(log, 'Felt: Good\n' + 'n'.repeat(2500), T), 'setLogNotes');
      ok(discardLog(log, T), 'discardLog');
    }
    // Finishing needs a ticked set; reopening needs a log finished automatically within the last day.
    const finished = finishLog(locked, T);
    ok(finished, 'finishLog');
    expect(finished.status).toBe('completed');
    ok(finishLog(pickedLog, T), 'finishLog');
    const auto = autoFinish(locked);
    ok(reopenLog(auto, T), 'reopenLog');
    expect(reopenLog(auto, T).status).toBe('in_progress');
  });
  it('the test above exercises every function ops.ts exports', () => {
    // dropParentId reads a doc and returns an id; it never returns a log.
    const notLogOps = new Set(['dropParentId']);
    const exported = Object.entries(ops)
      .filter(([, v]) => typeof v === 'function')
      .map(([name]) => name)
      .filter((name) => !notLogOps.has(name));
    expect([...exercised].sort()).toEqual(exported.sort());
  });
  it('refuses stepping and typing into an unpicked option', () => {
    const log = picked(build(), 1);
    const other = optionSets(log, 0)[0]!;
    expect(stepActual(log, other, 'reps', 1, 'kg', 10)).toBe(log);
    expect(updateActual(log, other, { actualReps: 5 })).toBe(log);
  });
  it('removing an option never leaves a choice with a pick turned straight', () => {
    const log = picked(build(), 1);
    const r = removeLogExercise(log, optionId(log, 0), T);
    expect(r.blocks.some((b) => b.pickedExerciseId !== null && b.kind !== 'choice')).toBe(false);
    ok(r);
  });
});
