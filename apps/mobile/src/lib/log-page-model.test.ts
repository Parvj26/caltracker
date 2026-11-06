import {
  WorkoutDoc,
  addChoice,
  addSection,
  addStraightBlock,
  addSuperset,
  completeSetWith,
  emptyWorkout,
  pickChoice,
  removeLogExercise,
  startLogFromWorkout,
  updateActual,
  type ExercisePick,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { describe, expect, it } from 'vitest';
import type { LastResults } from './log-api';
import { sampleLog, upperCoreLog } from './log-fixtures';
import {
  buildPageModel,
  firstOpenPage,
  listSections,
  progressGroups,
  sectionLine,
  pageAfterDone,
  pageIndexAfterChange,
  pickFirstOnly,
  progressLabel,
  progressStates,
  restLeftLabel,
} from './log-page-model';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const NOW = '2026-11-06T10:00:00.000Z';

const set = (setType = 'normal', over: Record<string, unknown> = {}) => ({
  id: uuid(),
  setType,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetWeightKg: 60,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: setType === 'drop' ? 0 : 90,
  note: null,
  ...over,
});
const exercise = (name: string, sets: unknown[], trackingType = 'weight_reps') => ({
  id: uuid(),
  exerciseId: uuid(),
  exerciseName: name,
  trackingType,
  note: null,
  sets,
});

function fixture(): WorkoutLogDoc {
  const drop = set('drop', { targetRepsMin: null, targetRepsMax: null, targetWeightKg: 40, toFailure: true });
  const workout = WorkoutDoc.parse({
    id: uuid(),
    name: 'Upper A',
    notes: null,
    blocks: [
      { id: uuid(), kind: 'straight', exercises: [exercise('Barbell Squat', [set('warmup'), set(), set(), set(), drop])] },
      {
        id: uuid(),
        kind: 'superset',
        exercises: [exercise('Bench press', [set(), set(), set()]), exercise('Cable row', [set(), set(), set()])],
      },
      {
        id: uuid(),
        kind: 'superset',
        exercises: [
          exercise('Pull-up', [set('normal', { targetWeightKg: null }), set('normal', { targetWeightKg: null })], 'reps'),
          exercise('Push-up', [set('normal', { targetWeightKg: null }), set('normal', { targetWeightKg: null })], 'reps'),
        ],
      },
    ],
  });
  return startLogFromWorkout(workout, uuid, NOW);
}

const sets = (log: WorkoutLogDoc, bi: number, ei = 0) => log.blocks[bi].exercises[ei].sets;
const tick = (log: WorkoutLogDoc, ...ids: string[]) =>
  ids.reduce((l, id) => completeSetWith(l, id, { reps: 8, weightKg: 60, durationS: null, distanceM: null }, NOW), log);
const build = (log: WorkoutLogDoc, blockIndex: number, last: LastResults = {}, units: 'lb' | 'kg' = 'lb') =>
  buildPageModel({ log, blockIndex, units, last });

describe('buildPageModel, straight page', () => {
  it('at the start: warm-up, steppers and reference', () => {
    const log = fixture();
    const exId = log.blocks[0].exercises[0].exerciseId;
    const last: LastResults = {
      [exId]: { finishedAt: NOW, sets: [{ setType: 'normal', actualReps: 8, actualWeightKg: 61.235, actualDurationS: null, actualDistanceM: null }] },
    };
    const m = build(log, 0, last);
    expect(m.kind).toBe('straight');
    expect(m.current!.setName).toBe('Warm-up 1 of 1');
    expect(m.current!.doneLabel).toBe('Done · start rest 1:30');
    expect(m.current!.steppers.map((s) => s.field)).toEqual(['weight', 'reps']);
    expect(m.current!.steppers.map((s) => s.display)).toEqual(['132', '10']);
    expect(m.current!.steppers.map((s) => s.unit)).toEqual(['lb', 'reps']);
    expect(m.current!.bodyTile).toBe(false);
    expect(m.current!.dots).toEqual(['current', 'todo', 'todo', 'todo']);
    expect(m.hasWarmups).toBe(true);
    expect(m.exercises[0].label).toBeNull();
    expect(m.exercises[0].reference).toBe('Coach: 8–10 reps · 132 lb · Last time: 135 lb × 8');
    expect(m.round).toBeNull();
    expect(m.upNext).toBe('A1 Bench press + A2 Cable row');
  });

  it('shows only the coach half without last time, and nothing when there is nothing', () => {
    const m = build(fixture(), 0);
    expect(m.exercises[0].reference).toBe('Coach: 8–10 reps · 132 lb');
  });

  it('carries the changed weight to the next set', () => {
    let log = fixture();
    const [w, s1, s2] = sets(log, 0);
    log = tick(log, w.id);
    log = updateActual(log, s1.id, { actualWeightKg: 70, actualReps: 8 });
    log = tick(log, s1.id);
    const m = build(log, 0);
    expect(m.current!.setName).toBe('Set 2 of 3');
    expect(m.current!.step.setId).toBe(s2.id);
    expect(m.current!.values.weightKg).toBe(70);
    expect(m.current!.steppers[0].display).toBe('154');
    expect(m.nextLine).toBe('Barbell Squat · set 2 of 3 · 154 lb × 10');
    expect(m.current!.dots).toEqual(['warmup-done', 'done', 'current', 'todo']);
  });

  it('lists main and drop together on a set with a drop, then moves to the drop', () => {
    let log = fixture();
    const all = sets(log, 0);
    log = tick(log, all[0].id, all[1].id, all[2].id);
    let m = build(log, 0);
    expect(m.current!.setName).toBe('Set 3 of 3');
    expect(m.current!.dropSteps!.map((r) => r.chip)).toEqual(['3', '↳']);
    expect(m.current!.doneLabel).toBe('Done · straight to drop 1');
    log = tick(log, all[3].id);
    m = build(log, 0);
    expect(m.current!.setName).toBe('Drop 1 of 1');
    expect(m.current!.step.kind).toBe('drop');
    expect(m.current!.doneLabel).toBe('Done · start rest 1:30');
    expect(m.current!.dropSteps!.map((r) => [r.done, r.current])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(m.current!.dots).toEqual(['warmup-done', 'done', 'done', 'current']);
  });

  it('allDone has no current step and a full step list', () => {
    let log = fixture();
    log = tick(log, ...sets(log, 0).map((s) => s.id));
    const m = build(log, 0);
    expect(m.allDone).toBe(true);
    expect(m.current).toBeNull();
    expect(m.nextLine).toBeNull();
    expect(m.steps).toHaveLength(5);
    expect(m.steps.every((s) => s.done && !s.current)).toBe(true);
    expect(m.steps[1].text).toBe('132 lb × 8');
  });

  it('workoutDone only once every page is done (the all-done card then offers Finish, not Next exercise)', () => {
    let log = fixture();
    log = tick(log, ...sets(log, 0).map((s) => s.id));
    expect(build(log, 0).workoutDone).toBe(false);
    const allIds = log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets.map((s) => s.id)));
    log = tick(log, ...allIds);
    expect(build(log, 0).workoutDone).toBe(true);
    expect(build(log, 1).workoutDone).toBe(true);
  });

  it('a plan row for an unticked step', () => {
    const m = build(fixture(), 0);
    expect(m.steps[0].chip).toBe('W');
    expect(m.steps[1].text).toBe('8–10 reps · 132 lb');
    expect(m.steps[4].text).toBe('88 lb × to failure');
    expect(m.steps[1].current).toBe(false);
    expect(m.steps[0].current).toBe(true);
  });
});

describe('buildPageModel, superset page', () => {
  it('has labels, rounds, rest and the collapsed card', () => {
    const m = build(fixture(), 1);
    expect(m.kind).toBe('superset');
    expect(m.exercises.map((e) => e.label)).toEqual(['A1', 'A2']);
    expect(m.exercises.map((e) => e.active)).toEqual([true, false]);
    expect(m.round).toEqual({
      current: 1,
      total: 3,
      restText: 'Rest 1:30 after both',
      chips: ['current', 'todo', 'todo'],
      afterRound: 'Round 2 · A1 Bench press',
    });
    expect(m.exercises[1].collapsedText).toBe('Up next · 8–10 reps · 132 lb');
    expect(m.exercises[0].collapsedText).toBeNull();
    expect(m.current!.doneLabel).toBe('Done · straight to A2');
    expect(m.nextLine).toBe('A1 Bench press · set 1 of 3 · 132 lb × 10');
  });

  it('shows the ticked result on the other card, and the last round points at the next page', () => {
    let log = fixture();
    log = tick(log, sets(log, 1, 0)[0].id);
    let m = build(log, 1);
    expect(m.exercises[1].active).toBe(true);
    expect(m.exercises[0].collapsedText).toBe('Done · 132 lb × 8');
    expect(m.nextLine!.startsWith('A2 Cable row')).toBe(true);
    for (let r = 0; r < 2; r += 1) log = tick(log, sets(log, 1, 0)[r].id, sets(log, 1, 1)[r].id);
    log = tick(log, sets(log, 1, 1)[0].id);
    m = build(log, 1);
    expect(m.round!.chips).toEqual(['done', 'done', 'current']);
    expect(m.round!.afterRound).toBe('B1 Pull-up + B2 Push-up');
  });

  it('a reps-only superset has a body tile and one stepper', () => {
    const m = build(fixture(), 2);
    expect(m.current!.bodyTile).toBe(true);
    expect(m.current!.steppers.map((s) => s.field)).toEqual(['reps']);
    expect(m.upNext).toBeNull();
  });

  it('goes back to an unticked A1 when asked, and the cards agree', () => {
    let log = fixture();
    const a = sets(log, 1, 0);
    const b = sets(log, 1, 1);
    log = tick(log, a[0].id, b[0].id);
    log = { ...log, blocks: log.blocks.map((bl, i) => (i !== 1 ? bl : { ...bl, exercises: bl.exercises.map((e, ei) => (ei !== 0 ? e : { ...e, sets: e.sets.map((s, si) => (si === 0 ? { ...s, completedAt: null } : s)) })) })) };
    const m = buildPageModel({ log, blockIndex: 1, units: 'lb', last: {}, preferExerciseIndex: 0 });
    expect(m.current!.step.setId).toBe(a[0].id);
    expect(m.exercises.map((e) => e.active)).toEqual([true, false]);
    expect(m.exercises.map((e) => e.collapsedText)).toEqual([null, 'Done · 132 lb × 8']);
    expect(m.round!.chips[0]).toBe('current');
  });

  it('prefers the exercise asked for', () => {
    const m = buildPageModel({ log: fixture(), blockIndex: 1, units: 'kg', last: {}, preferExerciseIndex: 1 });
    expect(m.current!.step.exerciseIndex).toBe(1);
    expect(m.exercises[1].active).toBe(true);
  });
});

describe('page list and progress', () => {
  it('progressStates and progressLabel', () => {
    let log = fixture();
    log = tick(log, ...sets(log, 0).map((s) => s.id));
    const states = progressStates(log, 1);
    expect(states).toEqual(['done', 'current', 'todo']);
    expect(progressLabel(states)).toBe('Exercise 2 of 3. 1 done.');
  });

  it('listSections without sections is one heading-less section (the regression)', () => {
    let log = fixture();
    log = tick(log, sets(log, 0)[0].id, sets(log, 0)[1].id);
    expect(listSections(log)).toEqual([
      {
        heading: null,
        rows: [
          { pageIndex: 0, title: 'Barbell Squat', detail: '1 of 3 sets', done: false },
          { pageIndex: 1, title: 'A1 Bench press + A2 Cable row', detail: '0 of 6 sets', done: false },
          { pageIndex: 2, title: 'B1 Pull-up + B2 Push-up', detail: '0 of 4 sets', done: false },
        ],
      },
    ]);
    expect(progressGroups(log, 1)).toEqual([['todo', 'current', 'todo']]);
  });
});

describe('sections and pick-one pages', () => {
  const FINISHER = 5;
  const allIds = (log: WorkoutLogDoc, bi: number) => log.blocks[bi].exercises.flatMap((e) => e.sets.map((s) => s.id));
  const tickPages = (log: WorkoutLogDoc, pages: number[]) => tick(log, ...pages.flatMap((p) => allIds(log, p)));
  const pickOpt = (log: WorkoutLogDoc, ei: number) =>
    pickChoice(log, log.blocks[FINISHER].id, log.blocks[FINISHER].exercises[ei].id, NOW);

  it('names the section place on each page, and null without sections', () => {
    const log = upperCoreLog();
    expect(build(log, 1).section).toEqual({ name: 'Core (Activation)', at: 1, of: 1 });
    expect(build(log, 3).section).toEqual({ name: 'Resistance Training', at: 2, of: 3 });
    expect(sectionLine({ name: 'Core (Activation)', at: 1, of: 2 })).toBe('Core (Activation) · 1 of 2');
    expect(build(fixture(), 0).section).toBeNull();
    expect(build(sampleLog(), 0).section).toBeNull();
  });

  it('counts places across straight, superset and pick-one pages of one section', () => {
    const pick = (name: string): ExercisePick => ({ id: uuid(), name, trackingType: 'weight_reps' });
    let d = emptyWorkout(uuid, 'Mixed');
    d = addSection(d, 'Main', uuid);
    d = addStraightBlock(d, pick('Squat'), uuid);
    d = addSuperset(d, [pick('Pull-up'), pick('Push-up')], uuid);
    d = addChoice(d, [pick('Slam'), pick('Carry')], uuid);
    const log = startLogFromWorkout(WorkoutDoc.parse(d), uuid, NOW);
    expect(log.blocks.map((b) => b.kind)).toEqual(['straight', 'superset', 'choice']);
    expect([0, 1, 2].map((p) => build(log, p).section)).toEqual([
      { name: 'Main', at: 1, of: 3 },
      { name: 'Main', at: 2, of: 3 },
      { name: 'Main', at: 3, of: 3 },
    ]);
  });

  it('pickFirstOnly picks only while nothing is picked, so a second quick tap cannot flip the pick', () => {
    const log = upperCoreLog();
    const block = log.blocks[FINISHER];
    const [slam, walk] = block.exercises;
    const picked = pickFirstOnly(log, block.id, slam.id, NOW);
    expect(picked.blocks[FINISHER].pickedExerciseId).toBe(slam.id);
    expect(pickFirstOnly(picked, block.id, walk.id, NOW)).toBe(picked);
    expect(pickFirstOnly(log, 'no-such-block', slam.id, NOW)).toBe(log);
  });

  it('progressGroups: one group per section run, with the current page marked', () => {
    const log = tickPages(upperCoreLog(), [0]);
    const groups = progressGroups(log, 3);
    expect(groups.map((g) => g.length)).toEqual([1, 1, 3, 1]);
    expect(groups).toEqual([['done'], ['todo'], ['todo', 'current', 'todo'], ['todo']]);
    expect(progressGroups(fixture(), 0)).toHaveLength(1);
  });

  it('listSections: four headings with rows carrying their page index', () => {
    const log = upperCoreLog();
    const sections = listSections(log);
    expect(sections.map((s) => s.heading)).toEqual(['Warm-Up', 'Core (Activation)', 'Resistance Training', 'Finisher']);
    expect(sections[2].rows.map((r) => r.pageIndex)).toEqual([2, 3, 4]);
    expect(sections[3].rows).toEqual([
      { pageIndex: 5, title: "Pick one: Medicine Ball Slam or Farmer's Walk", detail: 'Not picked yet', done: false },
    ]);
  });

  it('hides a section heading that has no pages left', () => {
    let log = upperCoreLog();
    log = removeLogExercise(log, log.blocks[1].exercises[0].id, NOW);
    expect(listSections(log).map((s) => s.heading)).toEqual(['Warm-Up', 'Resistance Training', 'Finisher']);
    expect(progressGroups(log, 0)).toHaveLength(3);
  });

  it('an unpicked pick-one page is a choice model with two options', () => {
    const m = build(upperCoreLog(), FINISHER);
    expect(m.kind).toBe('choice');
    expect(m.current).toBeNull();
    expect(m.steps).toEqual([]);
    expect(m.allDone).toBe(false);
    expect(m.choice!.heading).toBe('Finisher · pick one');
    expect(m.choice!.options.map((o) => o.name)).toEqual(['Medicine Ball Slam', "Farmer's Walk"]);
    expect(m.choice!.options[0].plan).toBe('3 sets');
    expect(m.choice!.picked).toBe(false);
    expect(m.choice!.canSwitch).toBe(true);
    expect(m.choice!.pickedLine).toBeNull();
    expect(m.upNext).toBeNull();
  });

  it('heading is just "Pick one" when the group has no section', () => {
    let log = upperCoreLog();
    log = { ...log, blocks: log.blocks.map((b, i) => (i === FINISHER ? { ...b, sectionId: null } : b)) };
    expect(build(log, FINISHER).choice!.heading).toBe('Pick one');
    expect(build(log, FINISHER).section).toBeNull();
  });

  it('a picked pick-one page describes only the picked option, like a straight page', () => {
    const log = pickOpt(upperCoreLog(), 0);
    const m = build(log, FINISHER);
    expect(m.kind).toBe('choice');
    expect(m.exercises.map((e) => e.name)).toEqual(['Medicine Ball Slam']);
    expect(m.exercises[0].exerciseIndex).toBe(0);
    expect(m.steps).toHaveLength(3);
    expect(m.current!.setName).toBe('Set 1 of 3');
    expect(m.choice!.picked).toBe(true);
    expect(m.choice!.pickedLine).toBe('Picked from 2 options');
    expect(m.choice!.canSwitch).toBe(true);
    // the other option can be picked instead
    expect(build(pickOpt(log, 1), FINISHER).exercises.map((e) => e.name)).toEqual(["Farmer's Walk"]);
    expect(listSections(log)[3].rows[0]).toMatchObject({ title: 'Medicine Ball Slam', detail: '0 of 3 sets' });
  });

  it('cannot switch after a done set', () => {
    let log = pickOpt(upperCoreLog(), 0);
    log = tick(log, log.blocks[FINISHER].exercises[0].sets[0].id);
    const m = build(log, FINISHER);
    expect(m.choice!.canSwitch).toBe(false);
    expect(listSections(log)[3].rows[0].detail).toBe('1 of 3 sets');
  });

  it('up next before an unpicked pick-one page', () => {
    expect(build(upperCoreLog(), 4).upNext).toBe("Pick one · Medicine Ball Slam or Farmer's Walk");
  });

  it('an unpicked group is open: the first open page and progress treat it as to-do', () => {
    const log = tickPages(upperCoreLog(), [0, 1, 2, 3, 4]);
    expect(firstOpenPage(log)).toBe(FINISHER);
    expect(progressGroups(log, 0)[3]).toEqual(['todo']);
  });
});

describe('page list helpers', () => {
  it('pageIndexAfterChange', () => {
    expect(pageIndexAfterChange({ blockIds: ['a', 'b', 'c'], index: 1 }, ['a', 'c'])).toBe(1);
    expect(pageIndexAfterChange({ blockIds: ['a', 'b', 'c'], index: 2 }, ['a', 'b'])).toBe(1);
    expect(pageIndexAfterChange({ blockIds: ['a', 'b', 'c'], index: 2 }, ['b', 'c'])).toBe(1);
    expect(pageIndexAfterChange({ blockIds: ['a', 'b', 'c'], index: 1 }, ['a', 'b', 'c', 'd'])).toBe(1);
    expect(pageIndexAfterChange({ blockIds: ['a'], index: 0 }, [])).toBe(0);
    // a page added before the current one, a reorder, and a swap (same block id) keep the same page
    expect(pageIndexAfterChange({ blockIds: ['a', 'b'], index: 1 }, ['x', 'a', 'b'])).toBe(2);
    expect(pageIndexAfterChange({ blockIds: ['a', 'b', 'c'], index: 0 }, ['c', 'b', 'a'])).toBe(2);
    expect(pageIndexAfterChange({ blockIds: ['a', 'b'], index: 1 }, ['a', 'b'])).toBe(1);
    // a stale index beyond the old pages falls back to the last page
    expect(pageIndexAfterChange({ blockIds: ['a', 'b'], index: 5 }, ['a', 'b', 'c'])).toBe(2);
    expect(pageIndexAfterChange({ blockIds: ['a', 'b'], index: 5 }, ['a'])).toBe(0);
  });
});

describe('doneThenAdvance', () => {
  const allIds = (log: WorkoutLogDoc, bi: number) => log.blocks[bi].exercises.flatMap((e) => e.sets.map((s) => s.id));

  it('stays on the page while it has open sets', () => {
    let log = fixture();
    log = tick(log, sets(log, 0)[0].id);
    expect(pageAfterDone(log, 0)).toBe(0);
  });

  it('moves forward to the next page with open sets', () => {
    let log = fixture();
    log = tick(log, ...allIds(log, 0));
    expect(pageAfterDone(log, 0)).toBe(1);
    // a finished page in between is skipped
    log = tick(log, ...allIds(log, 1));
    expect(pageAfterDone(log, 0)).toBe(2);
  });

  it('wraps round to a skipped page', () => {
    let log = fixture();
    log = tick(log, ...allIds(log, 2));
    expect(pageAfterDone(log, 2)).toBe(0);
  });

  it('stays put when every set is done', () => {
    let log = fixture();
    log = tick(log, ...allIds(log, 0), ...allIds(log, 1), ...allIds(log, 2));
    expect(pageAfterDone(log, 1)).toBe(1);
  });
});

describe('firstOpenPage', () => {
  it('is the first page with an unticked set, or 0', () => {
    let log = fixture();
    expect(firstOpenPage(log)).toBe(0);
    log = tick(log, ...log.blocks[0].exercises.flatMap((e) => e.sets.map((s) => s.id)));
    expect(firstOpenPage(log)).toBe(1);
    log = tick(log, ...log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets.map((s) => s.id))));
    expect(firstOpenPage(log)).toBe(0);
    expect(firstOpenPage({ ...log, blocks: [] })).toBe(0);
  });
});

describe('restLeftLabel', () => {
  it('says 1 second, not 1 seconds', () => {
    expect(restLeftLabel(1)).toBe('1 second of rest left');
    expect(restLeftLabel(30)).toBe('30 seconds of rest left');
  });
});
