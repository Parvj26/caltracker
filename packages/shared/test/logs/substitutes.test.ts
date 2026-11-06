import { describe, expect, it } from 'vitest';
import { logBests } from '../../src/awards/prs';
import { strengthExercises } from '../../src/awards/strength-series';
import { blockSteps } from '../../src/logs/flow';
import * as ops from '../../src/logs/ops';
import { completeSet, completeSetWith, finishLog, swapLogExercise, uncompleteSet, updateActual } from '../../src/logs/ops';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import * as subs from '../../src/logs/substitutes';
import {
  chooseSubstitute,
  clearSubstitute,
  isSubstituteLocked,
  liveExercise,
  otherSubstituteOptions,
  substituteChoices,
  substitutedFrom,
} from '../../src/logs/substitutes';
import { completedSetCount, logVolumeKg, openSetCount } from '../../src/logs/summary';
import { LOG_TREE_SELECT, logRowToDoc } from '../../src/logs/tree';
import type { LogTreeRow } from '../../src/logs/tree';
import { addStraightBlock, addSubstitute, addSuperset, emptyWorkout, updateSubstitute, updateSubstituteSet } from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';
import { uuid } from './fixture';

const T0 = '2026-11-06T10:00:00.000Z';
const T1 = '2026-11-06T10:05:00.000Z';
const LAT: ExercisePick = { id: uuid(), name: 'Lat Pulldown', trackingType: 'weight_reps' };
const ASSIST: ExercisePick = { id: uuid(), name: 'Machine Assisted Pull Up', trackingType: 'weight_reps' };
const BAND: ExercisePick = { id: uuid(), name: 'Band Pull Up', trackingType: 'reps' };
const ROW: ExercisePick = { id: uuid(), name: 'Cable Row', trackingType: 'weight_reps' };
const FACE: ExercisePick = { id: uuid(), name: 'Face Pull', trackingType: 'weight_reps' };

/** Lat Pulldown (or Machine Assisted Pull Up with 2 sets, or Band Pull Up) then a superset Row (or Face Pull) + Lat. */
function workout(): WorkoutDoc {
  let d = emptyWorkout(uuid, 'Back');
  d = addStraightBlock(d, LAT, uuid);
  d = addSuperset(d, [ROW, LAT], uuid);
  const b0 = d.blocks[0]!;
  d = addSubstitute(d, b0.id, b0.exercises[0]!.id, ASSIST, uuid);
  d = addSubstitute(d, b0.id, b0.exercises[0]!.id, BAND, uuid);
  const sub = d.blocks[0]!.exercises[0]!.substitutes[0]!;
  d = updateSubstituteSet(d, b0.id, b0.exercises[0]!.id, sub.id, sub.sets[0]!.id, { targetWeightKg: 30 });
  d = updateSubstitute(d, b0.id, b0.exercises[0]!.id, sub.id, { note: 'Blue band' });
  const b1 = d.blocks[1]!;
  d = addSubstitute(d, b1.id, b1.exercises[0]!.id, FACE, uuid);
  return WorkoutDoc.parse(d);
}

const start = () => startLogFromWorkout(workout(), uuid, T0);
const lat = (log: WorkoutLogDoc) => log.blocks[0]!.exercises[0]!;
const subId = (log: WorkoutLogDoc, i: number) => lat(log).substituteOptions[i]!.substituteId;
const ok = (l: WorkoutLogDoc) => expect(WorkoutLogDoc.safeParse(l).success).toBe(true);

describe('startLogFromWorkout with substitutes', () => {
  it('lists the planned exercise first, then the substitutes, and starts on the planned one', () => {
    const log = start();
    ok(log);
    const ex = lat(log);
    expect(ex.substituteId).toBeNull();
    expect(ex.exerciseId).toBe(LAT.id);
    expect(ex.substituteOptions.map((o) => o.exerciseName)).toEqual(['Lat Pulldown', 'Machine Assisted Pull Up', 'Band Pull Up']);
    expect(ex.substituteOptions[0]!.substituteId).toBeNull();
    expect(ex.substituteOptions[1]!.sets[0]!.target.weightKg).toBe(30);
    expect(ex.substituteOptions[2]!.trackingType).toBe('reps');
    expect(ex.substituteOptions[1]!.note).toBe('Blue band');
    expect(ex.substituteOptions[0]!.note).toBeNull();
    // An exercise without substitutes has no options at all.
    expect(log.blocks[1]!.exercises[1]!.substituteOptions).toEqual([]);
  });

  it('a log saved before substitutes still parses, with none', () => {
    const raw = JSON.parse(JSON.stringify(start())) as { blocks: Array<{ exercises: Array<Record<string, unknown>> }> };
    for (const b of raw.blocks)
      for (const e of b.exercises) {
        delete e.substituteId;
        delete e.substituteOptions;
      }
    const parsed = WorkoutLogDoc.parse(raw);
    expect(parsed.blocks.every((b) => b.exercises.every((e) => e.substituteId === null && e.substituteOptions.length === 0))).toBe(true);
  });
});

describe('chooseSubstitute / clearSubstitute', () => {
  it('swaps in the substitute exercise and its planned sets, then back', () => {
    const log = start();
    const chosen = chooseSubstitute(log, lat(log).id, subId(log, 1), uuid, T1);
    ok(chosen);
    const ex = lat(chosen);
    expect(ex).toMatchObject({ exerciseId: ASSIST.id, exerciseName: 'Machine Assisted Pull Up', substituteId: subId(log, 1), swappedFromExerciseId: LAT.id });
    expect(ex.sets[0]!.target.weightKg).toBe(30);
    expect(ex.sets.every((s) => s.completedAt === null && s.actualReps === null)).toBe(true);
    expect(ex.sets.some((s) => lat(log).sets.some((x) => x.id === s.id))).toBe(false);
    expect(chosen.revision).toBe(log.revision + 1);
    expect(chosen.lastActivityAt).toBe(T1);
    expect(substitutedFrom(ex)).toEqual({ exerciseId: LAT.id, exerciseName: 'Lat Pulldown' });
    expect(otherSubstituteOptions(ex).map((o) => o.exerciseName)).toEqual(['Lat Pulldown', 'Band Pull Up']);
    expect(substituteChoices(ex).find((c) => c.chosen)?.exerciseName).toBe('Machine Assisted Pull Up');

    const back = clearSubstitute(chosen, ex.id, uuid, T1);
    ok(back);
    expect(lat(back)).toMatchObject({ exerciseId: LAT.id, substituteId: null, swappedFromExerciseId: null });
    expect(lat(back).sets.map((s) => s.target)).toEqual(lat(log).sets.map((s) => s.target));
    expect(substitutedFrom(lat(back))).toBeNull();
  });

  it('switches between substitutes, including to another tracking type', () => {
    const log = start();
    const a = chooseSubstitute(log, lat(log).id, subId(log, 1), uuid, T1);
    const b = chooseSubstitute(a, lat(a).id, subId(log, 2), uuid, T1);
    ok(b);
    expect(lat(b)).toMatchObject({ exerciseId: BAND.id, trackingType: 'reps', swappedFromExerciseId: LAT.id });
  });

  it('is refused once a set is done, for unknown ids, the current option, or an exercise without substitutes', () => {
    const log = start();
    const done = completeSet(log, lat(log).sets[0]!.id, T1);
    expect(isSubstituteLocked(lat(done))).toBe(true);
    expect(chooseSubstitute(done, lat(done).id, subId(log, 1), uuid, T1)).toBe(done);
    expect(isSubstituteLocked(lat(log))).toBe(false);
    expect(chooseSubstitute(log, lat(log).id, null, uuid, T1)).toBe(log);
    expect(chooseSubstitute(log, lat(log).id, uuid(), uuid, T1)).toBe(log);
    expect(chooseSubstitute(log, uuid(), subId(log, 1), uuid, T1)).toBe(log);
    const plain = log.blocks[1]!.exercises[1]!;
    expect(chooseSubstitute(log, plain.id, null, uuid, T1)).toBe(log);
    // Unticking the set unlocks it again.
    const undone = uncompleteSet(done, lat(done).sets[0]!.id, T1);
    expect(chooseSubstitute(undone, lat(undone).id, subId(log, 1), uuid, T1)).not.toBe(undone);
  });

  it('a free swap drops the substitutes and keeps pointing at the planned exercise', () => {
    const log = start();
    const chosen = chooseSubstitute(log, lat(log).id, subId(log, 1), uuid, T1);
    const swapped = swapLogExercise(chosen, lat(chosen).id, ROW, T1);
    ok(swapped);
    expect(lat(swapped)).toMatchObject({ exerciseId: ROW.id, substituteId: null, substituteOptions: [], swappedFromExerciseId: LAT.id });
  });

  it('works inside a superset and keeps the round order', () => {
    const log = start();
    const row = log.blocks[1]!.exercises[0]!;
    const out = chooseSubstitute(log, row.id, row.substituteOptions[1]!.substituteId, uuid, T1);
    ok(out);
    expect(out.blocks[1]!.exercises[0]!.exerciseName).toBe('Face Pull');
    expect(blockSteps(out.blocks[1]!).map((s) => s.exerciseIndex)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('liveExercise is the exercise as done', () => {
    const log = start();
    const chosen = chooseSubstitute(log, lat(log).id, subId(log, 1), uuid, T1);
    expect(liveExercise(lat(chosen)).exerciseId).toBe(ASSIST.id);
  });
});

describe('counting only the exercise actually done', () => {
  const doneLog = () => {
    const first = start();
    let log = chooseSubstitute(first, lat(first).id, subId(first, 1), uuid, T1);
    for (const s of lat(log).sets) log = completeSetWith(log, s.id, { reps: 10, weightKg: 30, durationS: null, distanceM: null }, T1);
    return finishLog(log, T1);
  };

  it('volume, set counts, PRs and strength see the substitute, not the planned exercise', () => {
    const log = doneLog();
    ok(log);
    expect(log.status).toBe('completed');
    expect(completedSetCount(log)).toBe(3);
    expect(logVolumeKg(log)).toBe(3 * 10 * 30);
    expect(openSetCount(log)).toBe(6); // the superset's 6 sets; options not chosen add nothing
    const bests = logBests(log).map((r) => r.exerciseId);
    expect(bests).toContain(ASSIST.id);
    expect(bests).not.toContain(LAT.id);
    expect(strengthExercises([log]).map((e) => e.exerciseId)).toContain(ASSIST.id);
  });
});

describe('schema rules for substitute options', () => {
  const messages = (l: unknown) => {
    const r = WorkoutLogDoc.safeParse(l);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  const withLat = (log: WorkoutLogDoc, over: object) => ({
    ...log,
    blocks: log.blocks.map((b, i) => (i === 0 ? { ...b, exercises: [{ ...b.exercises[0]!, ...over }] } : b)),
  });
  it('refuses an unknown substitute and repeated options', () => {
    const log = start();
    expect(messages(withLat(log, { substituteId: uuid() }))).toEqual(['The substitute must be one of the options.']);
    const opts = lat(log).substituteOptions;
    expect(messages(withLat(log, { substituteOptions: [opts[0], opts[1], opts[1]] }))).toEqual(['Each substitute option appears once.']);
    expect(messages(withLat(log, { substituteOptions: [] , substituteId: opts[1]!.substituteId }))).toEqual(['The substitute must be one of the options.']);
  });
});

describe('logRowToDoc with substitutes', () => {
  it('reads substitute_id and substitute_options back into the doc', () => {
    const log = start();
    const chosen = chooseSubstitute(log, lat(log).id, subId(log, 1), uuid, T1);
    const ex = lat(chosen);
    const row: LogTreeRow = {
      id: chosen.id,
      workout_id: chosen.workoutId,
      name: chosen.name,
      status: chosen.status,
      started_at: chosen.startedAt,
      finished_at: null,
      last_activity_at: chosen.lastActivityAt,
      auto_finished: false,
      revision: chosen.revision,
      notes: null,
      log_blocks: [
        {
          id: chosen.blocks[0]!.id,
          position: 0,
          kind: 'straight',
          section_id: null,
          section_name: null,
          picked_exercise_id: null,
          log_exercises: [
            {
              id: ex.id,
              position: 0,
              exercise_id: ex.exerciseId,
              planned_workout_exercise_id: ex.plannedWorkoutExerciseId,
              swapped_from_exercise_id: ex.swappedFromExerciseId,
              note: null,
              substitute_id: ex.substituteId,
              substitute_options: JSON.parse(JSON.stringify(ex.substituteOptions)),
              exercises: { name: ex.exerciseName, tracking_type: ex.trackingType },
              log_sets: ex.sets.map((s, position) => ({
                id: s.id,
                position,
                set_type: s.setType,
                target_reps_min: s.target.repsMin,
                target_reps_max: s.target.repsMax,
                target_weight_kg: s.target.weightKg === null ? null : String(s.target.weightKg),
                target_duration_s: null,
                target_distance_m: null,
                to_failure: false,
                rest_seconds: s.target.restSeconds,
                actual_reps: null,
                actual_weight_kg: null,
                actual_duration_s: null,
                actual_distance_m: null,
                completed_at: null,
              })),
            },
          ],
        },
      ],
    };
    const doc = WorkoutLogDoc.parse(logRowToDoc(row));
    expect(doc.blocks[0]!.exercises[0]!.substituteId).toBe(ex.substituteId);
    expect(doc.blocks[0]!.exercises[0]!.substituteOptions).toEqual(ex.substituteOptions);
    // Bad and repeated options are left out; a substituteId that is no longer among them reads as null.
    const opts = JSON.parse(JSON.stringify(ex.substituteOptions)) as Array<Record<string, unknown>>;
    const messy = { ...row.log_blocks[0]!.log_exercises[0]!, substitute_options: [opts[0], { ...opts[1], trackingType: 'yoga' }, opts[0], 'junk', null] };
    const cleaned = WorkoutLogDoc.parse(logRowToDoc({ ...row, log_blocks: [{ ...row.log_blocks[0]!, log_exercises: [messy] }] }));
    expect(cleaned.blocks[0]!.exercises[0]!.substituteOptions).toHaveLength(1);
    expect(cleaned.blocks[0]!.exercises[0]!.substituteId).toBeNull();
    const notArray = logRowToDoc({ ...row, log_blocks: [{ ...row.log_blocks[0]!, log_exercises: [{ ...messy, substitute_options: { a: 1 } }] }] });
    expect(notArray.blocks[0]!.exercises[0]!.substituteOptions).toEqual([]);
    const older = { ...row.log_blocks[0]!.log_exercises[0]! };
    delete older.substitute_id;
    delete older.substitute_options;
    const old = logRowToDoc({ ...row, log_blocks: [{ ...row.log_blocks[0]!, log_exercises: [older] }] });
    expect(old.blocks[0]!.exercises[0]).toMatchObject({ substituteId: null, substituteOptions: [] });
  });
});

describe('every op keeps a log with substitutes valid (the phone drops a log that fails to parse)', () => {
  const values = { reps: 10, weightKg: 20, durationS: null, distanceM: null };
  const exercised = new Set<string>();
  const check = (l: WorkoutLogDoc, op: string) => {
    exercised.add(op);
    ok(l);
  };
  it('on planned, substituted and locked logs, for every exercise, set and option', () => {
    const planned = start();
    const substituted = chooseSubstitute(planned, lat(planned).id, subId(planned, 2), uuid, T0);
    const locked = completeSet(substituted, lat(substituted).sets[0]!.id, T0);
    for (const log of [planned, substituted, locked]) {
      ok(log);
      for (const b of log.blocks) {
        for (const e of b.exercises) {
          for (const s of e.sets) {
            check(ops.completeSet(log, s.id, T1), 'completeSet');
            check(ops.completeSetWith(log, s.id, values, T1), 'completeSetWith');
            check(ops.toggleSet(log, s.id, T1).log, 'toggleSet');
            check(ops.uncompleteSet(log, s.id, T1), 'uncompleteSet');
            check(updateActual(log, s.id, { actualReps: 3 }), 'updateActual');
            check(ops.stepActual(log, s.id, 'reps', 1, 'kg', 5), 'stepActual');
          }
          check(ops.addLogSet(log, e.id, uuid, T1), 'addLogSet');
          check(ops.addLogDrop(log, e.id, e.sets[0]!.id, uuid, T1), 'addLogDrop');
          check(ops.removeLogSet(log, e.id, e.sets[0]!.id, T1), 'removeLogSet');
          check(ops.swapLogExercise(log, e.id, FACE, T1), 'swapLogExercise');
          check(ops.removeLogExercise(log, e.id, T1), 'removeLogExercise');
          check(ops.setExerciseNote(log, e.id, 'n', T1), 'setExerciseNote');
          for (const o of e.substituteOptions) check(chooseSubstitute(log, e.id, o.substituteId, uuid, T1), 'chooseSubstitute');
          check(chooseSubstitute(log, e.id, uuid(), uuid, T1), 'chooseSubstitute');
          check(clearSubstitute(log, e.id, uuid, T1), 'clearSubstitute');
        }
        check(ops.pickChoice(log, b.id, null, T1), 'pickChoice');
      }
      check(ops.addLogExercise(log, ROW, uuid, T1), 'addLogExercise');
      check(ops.discardLog(log, T1), 'discardLog');
      check(ops.finishLog(log, T1), 'finishLog');
      check(ops.reopenLog({ ...ops.finishLog(locked, T1), autoFinished: true }, T1), 'reopenLog');
    }
  });
  it('the test above exercises every log op (ops.ts and substitutes.ts)', () => {
    const readers = new Set(['dropParentId', 'substituteChoices', 'otherSubstituteOptions', 'isSubstituteLocked', 'liveExercise', 'substitutedFrom']);
    const exported = [...Object.entries(ops), ...Object.entries(subs)]
      .filter(([, v]) => typeof v === 'function')
      .map(([name]) => name)
      .filter((name) => !readers.has(name));
    expect([...exercised].sort()).toEqual([...new Set(exported)].sort());
  });
});

it('the log tree select reads the substitute columns', () => {
  expect(LOG_TREE_SELECT).toContain('substitute_id, substitute_options');
});
