import {
  WorkoutDoc,
  addSubstitute,
  chooseSubstitute,
  completeSet,
  completeSetWith,
  addLogExercise,
  emptyLog,
  logVolumeKg,
  pickChoice,
  startLogFromWorkout,
  swapLogExercise,
  updateActual,
  WorkoutLogDoc as LogSchema,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { describe, expect, it } from 'vitest';
import type { LastResults } from './log-api';
import { upperCoreLog } from './log-fixtures';
import {
  afterDone,
  elapsedLabel,
  headerLines,
  lastCellText,
  nextAction,
  nextUpLabel,
  notTickedTitle,
  openSetsOnPage,
  startPlace,
  buildPage,
  deleteChoices,
  stepLabel,
  stepPlace,
  buildSections,
  finishModel,
  historyLines,
  markAll,
  markAllPlan,
  markAllQuestion,
  readTyped,
  invalidAnnouncement,
  sheetDraft,
  pageDots,
  pickingFirst,
  placeAfterChange,
  planChanges,
  resumePlace,
  fieldsFor,
  setRows,
  startGroups,
  hasTypedValues,
  substituteCards,
  substituteOf,
  supersetRounds,
  typedPatch,
  dropPlan,
  exerciseDropSetId,
  addDropSet,
  addRound,
  exerciseMenu,
  isRoundOpen,
  roundSummary,
  setMenu,
  toggleRound,
  type SupersetPageModel,
} from './log-flow-model';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const NOW = '2026-11-06T10:00:00.000Z';
const LB = 0.45359237;

const set = (setType = 'normal', over: Record<string, unknown> = {}) => ({
  id: uuid(),
  setType,
  targetRepsMin: 12,
  targetRepsMax: 12,
  targetWeightKg: 35 * LB,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 60,
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

/**
 * Parv - Upper/Core, as in the mock-ups: Warm-Up [Arm Circles 1 × 10 reps]; Resistance Training [superset Bench 4 sets
 * + Curl 3 sets (uneven), straight Pushdown with a warm-up, a drop and a to-failure set]; Finisher [pick one of Slam /
 * Farmers Walk / Throw].
 */
function mockWorkout(): WorkoutDoc {
  const warm = uuid();
  const main = uuid();
  const fin = uuid();
  const workout = WorkoutDoc.parse({
    id: uuid(),
    name: 'Parv - Upper/Core',
    notes: null,
    sections: [
      { id: warm, name: 'Warm-Up' },
      { id: main, name: 'Resistance Training' },
      { id: fin, name: 'Finisher' },
    ],
    blocks: [
      {
        id: uuid(),
        sectionId: warm,
        kind: 'straight',
        exercises: [exercise('Arm Circles', [set('normal', { targetWeightKg: null, targetRepsMin: 10, targetRepsMax: 10, restSeconds: 0 })], 'reps')],
      },
      {
        id: uuid(),
        sectionId: main,
        kind: 'superset',
        exercises: [
          exercise('Dumbbell Bench Press', [set(), set('normal', { targetWeightKg: 45 * LB }), set(), set()]),
          exercise('Alternating DB Curl', [set(), set(), set()]),
        ],
      },
      {
        id: uuid(),
        sectionId: main,
        kind: 'straight',
        exercises: [
          exercise('Cable Tricep Pushdown', [
            set('warmup'),
            set(),
            set('drop', { targetWeightKg: 20 * LB, restSeconds: 0 }),
            set('drop', { toFailure: true, targetWeightKg: 15 * LB, targetRepsMin: null, targetRepsMax: null, restSeconds: 0 }),
          ]),
        ],
      },
      {
        id: uuid(),
        sectionId: fin,
        kind: 'choice',
        exercises: [exercise('Medicine Ball Slam', [set(), set()]), exercise('Farmers Walk', [set(), set()]), exercise('Overhead Throw', [set(), set()])],
      },
    ],
  });
  return workout;
}

const mockLog = (): WorkoutLogDoc => startLogFromWorkout(mockWorkout(), uuid, NOW);

/** The mock-up's Lat Pulldown with its coach-added substitute, as the second exercise of the superset. */
function substituteLog(): WorkoutLogDoc {
  const w = mockWorkout();
  const block = w.blocks[1];
  const withSub = addSubstitute(w, block.id, block.exercises[0].id, { id: uuid(), name: 'Machine Assisted Pull Up', trackingType: 'weight_reps' }, uuid);
  return startLogFromWorkout(withSub, uuid, NOW);
}

const values = { reps: 10, weightKg: 20, durationS: null, distanceM: null };
const allSetIds = (log: WorkoutLogDoc, bi: number) => log.blocks[bi].exercises.flatMap((e) => e.sets.map((s) => s.id));
const tickAll = (log: WorkoutLogDoc, bi: number) => allSetIds(log, bi).reduce((l, id) => completeSetWith(l, id, values, NOW), log);

describe('buildSections', () => {
  it('turns sections into pages: a superset is one page, a pick-one group is one page with a switch', () => {
    const sections = buildSections(mockLog());
    expect(sections.map((s) => s.title)).toEqual(['Warm-Up', 'Resistance Training', 'Finisher']);
    expect(sections.map((s) => s.countLine)).toEqual(['1 exercise', '1 superset · 3 exercises', 'Pick one of 3']);
    expect(sections[1].pages.map((p) => p.kind)).toEqual(['superset', 'straight']);
    expect(sections[1].pages[0]).toMatchObject({ kind: 'superset', number: 1 });
    expect(sections[2].pages.map((p) => [p.kind, p.blockIndex, p.kind === 'option' && p.options])).toEqual([['option', 3, 3]]);
  });

  it('a workout without sections is one section named after the workout; an empty log still has one', () => {
    const log = mockLog();
    const plain = { ...log, sections: [], blocks: log.blocks.map((b) => ({ ...b, sectionId: null })) };
    const sections = buildSections(plain);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBeNull();
    expect(sections[0].title).toBe('Parv - Upper/Core');
    expect(sections[0].pages).toHaveLength(2 + 1 + 1);
    const empty = buildSections(emptyLog('Quick lift', uuid, NOW));
    expect(empty).toHaveLength(1);
    expect(empty[0].pages).toEqual([]);
    expect(empty[0].title).toBe('Quick lift');
  });

  it('exercises added after the last section form an unnamed section of their own', () => {
    const log = upperCoreLog();
    const added = { ...log, blocks: [...log.blocks, { ...log.blocks[0], id: uuid(), sectionId: null }] };
    const sections = buildSections(added);
    expect(sections.map((s) => s.title)).toEqual(['Warm-Up', 'Core (Activation)', 'Resistance Training', 'Finisher', 'More exercises']);
  });

  it('marks a section done once every page is', () => {
    let log = mockLog();
    expect(buildSections(log)[0].done).toBe(false);
    log = tickAll(log, 0);
    expect(buildSections(log)[0].done).toBe(true);
  });
});

describe('navigation', () => {
  it('Done goes to the next page, then the next section start, then the finish sheet', () => {
    const s = buildSections(mockLog());
    expect(afterDone(s, { section: 0, page: 0 })).toEqual({ kind: 'section', section: 1 });
    expect(afterDone(s, { section: 1, page: 0 })).toEqual({ kind: 'page', page: 1 });
    expect(afterDone(s, { section: 1, page: 1 })).toEqual({ kind: 'section', section: 2 });
    expect(afterDone(s, { section: 2, page: 0 })).toEqual({ kind: 'finish' });
  });

  it('steps one page back or forward across sections, without Next', () => {
    const s = buildSections(mockLog());
    expect(stepPlace(s, { section: 0, page: 0 }, -1)).toBeNull();
    expect(stepPlace(s, { section: 0, page: 0 }, 1)).toEqual({ section: 1, page: 0 });
    expect(stepPlace(s, { section: 1, page: 0 }, -1)).toEqual({ section: 0, page: 0 });
    expect(stepPlace(s, { section: 1, page: 0 }, 1)).toEqual({ section: 1, page: 1 });
    expect(stepPlace(s, { section: 1, page: 1 }, 1)).toEqual({ section: 2, page: 0 });
    // Back from a section's first page lands on the previous section's last page.
    expect(stepPlace(s, { section: 2, page: 0 }, -1)).toEqual({ section: 1, page: 1 });
    expect(stepPlace(s, { section: 2, page: 0 }, 1)).toBeNull();
  });

  it('steps over a section with no pages', () => {
    const s = buildSections(mockLog());
    const gap = [s[0], { ...s[1], pages: [] }, s[2]];
    expect(stepPlace(gap, { section: 0, page: 0 }, 1)).toEqual({ section: 2, page: 0 });
    expect(stepPlace(gap, { section: 2, page: 0 }, -1)).toEqual({ section: 0, page: 0 });
  });

  it('names where a step goes', () => {
    const s = buildSections(mockLog());
    expect(stepLabel(s, { section: 0, page: 0 }, -1)).toBeNull();
    expect(stepLabel(s, { section: 0, page: 0 }, 1)).toBe('Next section: Resistance Training');
    expect(stepLabel(s, { section: 1, page: 0 }, 1)).toBe('Next page');
    expect(stepLabel(s, { section: 1, page: 0 }, -1)).toBe('Previous section: Warm-Up');
    expect(stepLabel(s, { section: 1, page: 1 }, -1)).toBe('Previous page');
  });

  it('moving never logs anything: stepping leaves the log as it was', () => {
    const log = mockLog();
    const before = JSON.stringify(log);
    const s = buildSections(log);
    let at: { section: number; page: number } | null = { section: 0, page: 0 };
    let steps = 0;
    while (at) {
      at = stepPlace(s, at, 1);
      steps += 1;
    }
    expect(steps).toBe(4); // 1 + 2 + 1 pages, then the end
    expect(JSON.stringify(log)).toBe(before);
    expect(finishModel(log).done).toBe(0);
  });

  it('resumes at the first open page (a pick-one group is one page, picked or not)', () => {
    let log = mockLog();
    expect(resumePlace(log, buildSections(log))).toEqual({ section: 0, page: 0 });
    log = tickAll(tickAll(tickAll(log, 0), 1), 2);
    expect(resumePlace(log, buildSections(log))).toEqual({ section: 2, page: 0 });
    log = pickChoice(log, log.blocks[3].id, log.blocks[3].exercises[1].id, NOW);
    expect(resumePlace(log, buildSections(log))).toEqual({ section: 2, page: 0 });
    log = tickAll({ ...log }, 3);
    // completeSetWith refuses the unpicked options' sets, so only Farmers Walk's sets are ticked.
    expect(resumePlace(log, buildSections(log))).toBeNull();
  });

  it('keeps the same page on screen after the log changes, else the same spot', () => {
    const log = mockLog();
    const before = buildSections(log);
    const pageKey = before[1].pages[1].key;
    // The superset goes: the pushdown page moves from page 1 to page 0.
    const after = buildSections({ ...log, blocks: log.blocks.filter((_, i) => i !== 1) });
    expect(placeAfterChange(after, { sectionKey: before[1].key, pageKey, at: { section: 1, page: 1 } })).toEqual({ section: 1, page: 0 });
    expect(placeAfterChange(after, { sectionKey: before[1].key, pageKey: 'gone', at: { section: 1, page: 1 } })).toEqual({ section: 1, page: 0 });
  });

  it('dots show done, current and to-do pages', () => {
    let log = mockLog();
    log = tickAll(log, 2);
    const s = buildSections(log)[1];
    expect(pageDots(log, s, 0)).toEqual(['current', 'done']);
  });
});

describe('start page lists', () => {
  it('lists each exercise with its summary and ×N, supersets and pick-one options grouped', () => {
    const log = mockLog();
    const s = buildSections(log);
    const main = startGroups(log, s[1], 'lb');
    expect(main[0].kind).toBe('superset');
    if (main[0].kind !== 'superset') throw new Error('superset');
    expect(main[0].items.map((i) => [i.name, i.summary, i.count])).toEqual([
      ['Dumbbell Bench Press', '35 lb × 12, 45 lb × 12, 35 lb × 12, 35 lb × 12', '×4'],
      ['Alternating DB Curl', '35 lb × 12, 35 lb × 12, 35 lb × 12', '×3'],
    ]);
    expect(main[1].kind === 'straight' && main[1].item.count).toBe('×4'); // every tickable row counts, drops too;
    const fin = startGroups(log, s[2], 'lb');
    expect(fin[0].kind === 'choice' && fin[0].items.map((i) => i.name)).toEqual(['Medicine Ball Slam', 'Farmers Walk', 'Overhead Throw']);
    expect(startGroups(log, s[0], 'lb')[0]).toMatchObject({ kind: 'straight', item: { summary: '10 reps', count: '×1', substitute: null } });
  });
});

describe('set rows', () => {
  it('a normal set to failure (the builder\'s F) is tagged F but not indented, and keeps its set number', () => {
    const drop = { targetWeightKg: null, restSeconds: 0 };
    const sets = [set(), set('normal', { toFailure: true }), set('drop', drop), set()].map((x) => ({ ...x, targetWeightKg: null }));
    const doc = WorkoutDoc.parse({
      id: uuid(),
      name: 'F sets',
      notes: null,
      blocks: [{ id: uuid(), kind: 'straight', exercises: [exercise('Hanging Leg Raise', sets, 'reps')] }],
    });
    const log = startLogFromWorkout(doc, uuid, NOW);
    const rows = setRows(log.blocks[0].exercises[0], 'lb', []);
    expect(rows.map((r) => r.tag)).toEqual(['1', 'F', '↓ Drop', '3']);
    expect(rows.map((r) => r.tagKind)).toEqual(['normal', 'failure', 'drop', 'normal']);
    expect(rows.map((r) => r.name)).toEqual(['Set 1', 'Set 2 to failure', 'Drop set', 'Set 3']);
    expect(rows.map((r) => r.indented)).toEqual([false, false, true, false]);
  });

  it('columns follow the tracking type; warm-up W, every drop "↓ Drop" (to failure: "max")', () => {
    const log = mockLog();
    const push = log.blocks[2].exercises[0];
    const rows = setRows(push, 'lb', []);
    expect(rows.map((r) => r.tag)).toEqual(['W', '1', '↓ Drop', '↓ Drop']);
    expect(rows.map((r) => r.tagKind)).toEqual(['warmup', 'normal', 'drop', 'drop']);
    expect(rows[3].cells[1].placeholder).toBe('max');
    expect(rows[3].cells[0].placeholder).toBe('15');
    expect(rows.map((r) => r.name)).toEqual(['Warm-up 1', 'Set 1', 'Drop set', 'Drop set to failure']);
    expect(rows.map((r) => r.indented)).toEqual([false, false, true, true]);
    expect(rows[1].cells.map((c) => c.heading)).toEqual(['LB', 'REPS']);
    expect(rows[1].cells.map((c) => c.placeholder)).toEqual(['35', '12']);
    expect(rows[2].cells[0].placeholder).toBe('20');
    const circles = setRows(log.blocks[0].exercises[0], 'lb', []);
    expect(circles[0].cells.map((c) => c.heading)).toEqual(['REPS']);
  });

  it('a timed exercise has a TIME column, a distance one MI or KM', () => {
    const log = mockLog();
    const ex = log.blocks[0].exercises[0];
    expect(setRows({ ...ex, trackingType: 'time' }, 'lb', [])[0].cells.map((c) => c.heading)).toEqual(['TIME']);
    expect(setRows({ ...ex, trackingType: 'distance' }, 'kg', [])[0].cells.map((c) => c.heading)).toEqual(['KM']);
  });

  it('a tracking type this build does not know gets the reps column instead of crashing', () => {
    const ex = mockLog().blocks[0].exercises[0];
    const future = { ...ex, trackingType: 'sled_meters_per_minute' as unknown as typeof ex.trackingType };
    expect(fieldsFor(future)).toEqual(['reps']);
    expect(setRows(future, 'lb', [])[0].cells.map((c) => c.heading)).toEqual(['REPS']);
  });

  it('a weight-and-time exercise (a loaded carry) has a weight column, then TIME', () => {
    const ex = mockLog().blocks[0].exercises[0];
    expect(setRows({ ...ex, trackingType: 'weight_time' }, 'lb', [])[0].cells.map((c) => c.heading)).toEqual(['LB', 'TIME']);
    expect(setRows({ ...ex, trackingType: 'weight_time' }, 'kg', [])[0].cells.map((c) => c.heading)).toEqual(['KG', 'TIME']);
  });

  it('a ticked set keeps its numbers editable: the box shows what is stored', () => {
    let log = mockLog();
    const ex = () => log.blocks[2].exercises[0];
    log = completeSetWith(log, ex().sets[1].id, { reps: 12, weightKg: 35 * LB, durationS: null, distanceM: null }, NOW);
    log = updateActual(log, ex().sets[1].id, { actualReps: 9 });
    const row = setRows(ex(), 'lb', [])[1];
    expect(row.done).toBe(true);
    expect(row.cells.map((c) => c.value)).toEqual(['35', '9']);
  });

  it('a weight changed on one set carries into the next set (the shared pre-fill)', () => {
    let log = mockLog();
    const bench = () => log.blocks[1].exercises[0];
    log = updateActual(log, bench().sets[2].id, { actualWeightKg: 40 * LB });
    expect(setRows(bench(), 'lb', [])[3].cells[0].placeholder).toBe('40');
  });
});

describe('pages', () => {
  it('a superset page goes round by round and leaves an exercise out of rounds it has no set in', () => {
    let log = mockLog();
    const block = log.blocks[1];
    expect(supersetRounds(block).map((r) => r.entries.map((e) => e.exerciseIndex))).toEqual([[0, 1], [0, 1], [0, 1], [0]]);
    const page = buildSections(log)[1].pages[0];
    let m = buildPage(log, page, 'lb', {});
    expect(m.kind === 'superset' && m.heading).toBe('Superset A');
    expect(m.kind === 'superset' && m.rounds.map((r) => r.heading)).toEqual(['Round 1 of 4', 'Round 2 of 4', 'Round 3 of 4', 'Round 4 of 4']);
    // The next set to do is marked: A1's first set.
    expect(m.kind === 'superset' && m.rounds[0].entries.map((e) => e.rows[0].current)).toEqual([true, false]);
    expect(m.kind === 'superset' && m.exercises.map((e) => e.label)).toEqual(['A1', 'A2']);
    // One rest for every round: said once, in the intro, not under each round.
    expect(m.kind === 'superset' && m.intro).toBe('Back to back, then rest 1:00');
    expect(m.kind === 'superset' && m.rounds.map((r) => r.restLine)).toEqual([null, null, null, null]);
    expect(m.kind === 'superset' && m.rounds.map((r) => r.kind)).toEqual(['current', 'future', 'future', 'future']);
    log = completeSet(log, block.exercises[0].sets[0].id, NOW);
    // Ticking A1 moves the mark to A2.
    m = buildPage(log, page, 'lb', {});
    expect(m.kind === 'superset' && m.rounds[0].entries.map((e) => e.rows[0].current)).toEqual([false, true]);
    log = completeSet(log, block.exercises[1].sets[0].id, NOW);
    m = buildPage(log, page, 'lb', {});
    // The title stays "Superset A"; round 1 is ticked off under it and round 2 is the current one.
    expect(m.kind === 'superset' && m.heading).toBe('Superset A');
    expect(m.kind === 'superset' && m.currentRound).toBe(2);
    expect(m.kind === 'superset' && m.rounds.map((r) => r.heading)).toEqual(['Round 1 of 4', 'Round 2 of 4', 'Round 3 of 4', 'Round 4 of 4']);
    expect(m.kind === 'superset' && m.rounds.map((r) => r.kind)).toEqual(['done', 'current', 'future', 'future']);
    expect(m.kind === 'superset' && m.rounds[0].done).toBe(true);
    expect(m.kind === 'superset' && m.rounds[0].title).toBe('Round 1');
  });

  it('a straight page has the rest as text and last time for the history button', () => {
    const log = mockLog();
    const push = log.blocks[2].exercises[0];
    const last: LastResults = {
      [push.exerciseId]: { finishedAt: NOW, sets: [{ setType: 'normal', actualReps: 12, actualWeightKg: 70 * LB, actualDurationS: null, actualDistanceM: null }] },
    };
    const m = buildPage(log, buildSections(log)[1].pages[1], 'lb', last);
    expect(m.kind).toBe('straight');
    if (m.kind !== 'straight') throw new Error('straight');
    expect(m.exercise.restLine).toBe('Rest 1:00');
    expect(m.exercise.lastTime).toHaveLength(1);
    expect(historyLines(push, m.exercise.lastTime, 'lb')).toEqual(['1 · 70 lb × 12']);
  });

  it('a pick-one page shows the first option until one is chosen, and locks the switch after a tick', () => {
    let log = mockLog();
    const fin = buildSections(log)[2];
    const block = log.blocks[3];
    const names = block.exercises.map((e) => e.exerciseName);
    let m = buildPage(log, fin.pages[0], 'lb', {});
    expect(m).toMatchObject({ kind: 'option', picked: false, locked: false });
    expect(m.kind === 'option' && m.choices.map((c) => [c.name, c.chosen])).toEqual([[names[0], true], [names[1], false], [names[2], false]]);
    log = pickingFirst(log, block.id, block.exercises[1].id, NOW);
    m = buildPage(log, fin.pages[0], 'lb', {});
    expect(m).toMatchObject({ picked: true, locked: false });
    expect(m.kind === 'option' && m.exercise.name).toBe(names[1]);
    // Picked but nothing ticked: another option can still take over.
    expect(pickingFirst(log, block.id, block.exercises[0].id, NOW).blocks[3].pickedExerciseId).toBe(block.exercises[0].id);
    log = completeSet(log, block.exercises[1].sets[0].id, NOW);
    expect(pickingFirst(log, block.id, block.exercises[0].id, NOW)).toBe(log);
    expect(buildPage(log, fin.pages[0], 'lb', {})).toMatchObject({ locked: true });
  });
});

describe('markAll', () => {
  it('ticks every open set with its pre-fill, carrying a typed weight forward, and keeps the doc valid', () => {
    let log = mockLog();
    const bench = () => log.blocks[1].exercises[0];
    log = updateActual(log, bench().sets[0].id, { actualWeightKg: 40 * LB });
    log = markAll(log, [bench().id], {}, NOW);
    expect(bench().sets.every((s) => s.completedAt !== null)).toBe(true);
    // Set 2 has its own planned 45 lb; sets 3 and 4 carry the changed 40 lb.
    expect(bench().sets.map((s) => Math.round((s.actualWeightKg ?? 0) / LB))).toEqual([40, 45, 35, 35]);
    expect(LogSchema.safeParse(log).success).toBe(true);
  });

  it('leaves a ticked set as it is and an unpicked option untouched', () => {
    let log = mockLog();
    const opt = log.blocks[3].exercises[0];
    expect(markAll(log, [opt.id], {}, NOW)).toBe(log);
    log = completeSetWith(log, log.blocks[0].exercises[0].sets[0].id, values, NOW);
    expect(markAll(log, [log.blocks[0].exercises[0].id], {}, NOW)).toBe(log);
  });
});

describe('finish and summary', () => {
  it('counts the sets done and says which are not ticked', () => {
    let log = mockLog();
    expect(finishModel(log)).toMatchObject({ done: 0, noneDone: true });
    log = tickAll(tickAll(log, 0), 1);
    const block = log.blocks[3];
    log = pickChoice(log, block.id, block.exercises[0].id, NOW);
    log = tickAll(log, 3);
    const push = log.blocks[2].exercises[0];
    log = push.sets.slice(0, 2).reduce((l, s) => completeSet(l, s.id, NOW), log);
    expect(finishModel(log)).toEqual({
      done: 1 + 7 + 2 + 2,
      total: 14,
      headline: '12 of 14 done',
      unticked: '2 unticked won’t count',
      noneDone: false,
    });
  });

  it('counts a pick-one group not picked yet as its first option, then only the picked option', () => {
    let log = tickAll(tickAll(tickAll(mockLog(), 0), 1), 2);
    expect(finishModel(log)).toMatchObject({ total: 1 + 7 + 4 + 2, unticked: '2 unticked won’t count' });
    const block = log.blocks[3];
    log = pickChoice(log, block.id, block.exercises[2].id, NOW);
    expect(finishModel(log).unticked).toBe('2 unticked won’t count');
    expect(finishModel(tickAll(log, 3))).toMatchObject({ headline: '14 of 14 done', unticked: null });
  });

  it('lists the changes from the plan: swaps and the picked finisher', () => {
    let log = mockLog();
    const lat = log.blocks[2].exercises[0];
    log = swapLogExercise(log, lat.id, { id: uuid(), name: 'Machine Assisted Pull Up', trackingType: 'weight_reps' }, NOW);
    const block = log.blocks[3];
    log = pickChoice(log, block.id, block.exercises[0].id, NOW);
    log = completeSet(log, block.exercises[0].sets[0].id, NOW);
    const names: Record<string, string> = { [lat.exerciseId]: 'Cable Tricep Pushdown' };
    expect(planChanges(log, (id) => names[id] ?? null)).toEqual([
      '⇄ Did Machine Assisted Pull Up instead of Cable Tricep Pushdown',
      'Finisher: picked Medicine Ball Slam',
    ]);
    expect(planChanges(mockLog(), () => null)).toEqual([]);
  });
});

describe('typedPatch', () => {
  it('stores what was typed in the client units, and refuses what the log cannot hold', () => {
    expect(typedPatch('weight', 100, 'lb')!.actualWeightKg).toBeCloseTo(100 * LB, 3);
    expect(typedPatch('weight', 3000, 'kg')).toBeNull();
    expect(typedPatch('reps', null, 'kg')).toEqual({ actualReps: null });
    expect(typedPatch('distance', 2, 'kg')).toEqual({ actualDistanceM: 2000 });
    expect(typedPatch('duration', 45, 'kg')).toEqual({ actualDurationS: 45 });
  });
});

describe('coach-added substitutes', () => {
  it('shows "or: X" on the start page and the switch strip until a set is ticked', () => {
    let log = substituteLog();
    const sections = buildSections(log);
    const groups = startGroups(log, sections[1], 'lb');
    expect(groups[0].kind === 'superset' && groups[0].items[0].substitute).toBe('or: Machine Assisted Pull Up');
    const bench = log.blocks[1].exercises[0];
    expect(substituteOf(bench)).toEqual({ otherNames: 'Machine Assisted Pull Up', doingInsteadOf: null, locked: false });
    const page = buildPage(log, sections[1].pages[0], 'lb', {});
    expect(page.kind === 'superset' && page.exercises[0].substitute?.locked).toBe(false);
    log = completeSet(log, bench.sets[0].id, NOW);
    expect(substituteOf(log.blocks[1].exercises[0])!.locked).toBe(true);
  });

  it('lists Planned and Substitute cards, and after choosing shows the substitute with its planned name', () => {
    let log = substituteLog();
    const ex = () => log.blocks[1].exercises[0];
    const cards = substituteCards(ex(), 'lb');
    expect(cards.map((c) => [c.kind, c.name, c.chosen])).toEqual([
      ['Planned', 'Dumbbell Bench Press', true],
      ['Substitute', 'Machine Assisted Pull Up', false],
    ]);
    expect(cards[1].summary).toBe('35 lb × 12, 45 lb × 12, 35 lb × 12, 35 lb × 12');
    expect(cards[1].note).toBeNull();
    expect(hasTypedValues(ex())).toBe(false);
    expect(hasTypedValues(updateActual(log, ex().sets[0].id, { actualReps: 5 }).blocks[1].exercises[0])).toBe(true);
    log = chooseSubstitute(log, ex().id, cards[1].substituteId, uuid, NOW);
    expect(ex().exerciseName).toBe('Machine Assisted Pull Up');
    expect(substituteOf(ex())).toEqual({ otherNames: 'Dumbbell Bench Press', doingInsteadOf: 'Dumbbell Bench Press', locked: false });
    log = completeSet(log, ex().sets[0].id, NOW);
    expect(planChanges(log, () => null)).toEqual(['⇄ Did Machine Assisted Pull Up instead of Dumbbell Bench Press']);
    expect(LogSchema.safeParse(log).success).toBe(true);
  });
});

describe('readTyped', () => {
  it('says why a number can’t be saved instead of dropping it', () => {
    expect(readTyped('reps', '12.5', 'lb', false)).toEqual({ kind: 'invalid', message: 'Whole reps only' });
    expect(readTyped('reps', '1001', 'lb', false)).toEqual({ kind: 'invalid', message: 'That’s more than a set can hold' });
    expect(readTyped('weight', '2500', 'lb', false)).toEqual({ kind: 'invalid', message: 'That’s more than a set can hold' });
    expect(readTyped('weight', '1500', 'kg', false)).toEqual({ kind: 'invalid', message: 'That’s more than a set can hold' });
    expect(readTyped('duration', '1:75', 'lb', false)).toEqual({ kind: 'invalid', message: 'Use m:ss, like 1:30' });
    expect(readTyped('weight', 'abc', 'lb', false)).toEqual({ kind: 'invalid', message: 'Numbers only' });
    expect(readTyped('reps', '8', 'lb', false)).toEqual({ kind: 'ok', patch: { actualReps: 8 } });
  });

  it('clears an open set’s box, but refuses a blank on a ticked set', () => {
    expect(readTyped('reps', '', 'lb', false)).toEqual({ kind: 'ok', patch: { actualReps: null } });
    expect(readTyped('reps', ' ', 'lb', true)).toEqual({ kind: 'invalid', message: 'A ticked set needs a number' });
  });
});

describe('rows on ticked sets and deleting', () => {
  it('a ticked row never shows the greyed pre-fill; the only set of an exercise can’t be deleted', () => {
    let log = mockLog();
    const circles = () => log.blocks[0].exercises[0];
    expect(setRows(circles(), 'lb', [])[0].deletable).toBe(false);
    log = completeSet(log, circles().sets[0].id, NOW);
    expect(setRows(circles(), 'lb', [])[0].cells[0].placeholder).toBe('');
    const push = log.blocks[2].exercises[0];
    expect(setRows(push, 'lb', []).map((r) => r.deletable)).toEqual([true, true, true, true]);
  });
});

describe('markAllPlan', () => {
  it('counts the sets it would tick and the ones with nothing to save', () => {
    let log = emptyLog('Quick', uuid, NOW);
    log = addLogExercise(log, { id: uuid(), name: 'Pushups', trackingType: 'reps' }, uuid, NOW);
    const ex = log.blocks[0].exercises[0];
    log = updateActual(log, ex.sets[0].id, { actualReps: 10 });
    // 10 typed on set 1; sets 2 and 3 take the client's own reps from the set before.
    expect(markAllPlan(log, [ex.id], {})).toEqual({ tick: 3, skip: 0, noWeight: 0 });
    const blank = addLogExercise(emptyLog('Quick', uuid, NOW), { id: uuid(), name: 'Row', trackingType: 'weight_reps' }, uuid, NOW);
    const bex = blank.blocks[0].exercises[0];
    expect(markAllPlan(blank, [bex.id], {})).toEqual({ tick: 0, skip: 3, noWeight: 0 });
    expect(markAll(blank, [bex.id], {}, NOW)).toBe(blank);
    expect(markAllQuestion({ tick: 4, skip: 0, noWeight: 0 })).toEqual({ title: 'Tick 4 sets with these numbers?', message: null });
    expect(markAllQuestion({ tick: 2, skip: 1, noWeight: 0 }).message).toBe('1 set has no numbers yet, so it stays unticked.');
  });

  it('still ticks weight and reps sets with reps but no weight (bodyweight), and says how many have no weight', () => {
    let log = addLogExercise(emptyLog('Quick', uuid, NOW), { id: uuid(), name: 'Pull-up', trackingType: 'weight_reps' }, uuid, NOW);
    const ex = log.blocks[0].exercises[0];
    // Reps typed on set 1 only; no weight, no coach target, no last time.
    log = updateActual(log, ex.sets[0].id, { actualReps: 8 });
    const plan = markAllPlan(log, [ex.id], {});
    expect(plan).toEqual({ tick: 3, skip: 0, noWeight: 3 });
    const ticked = markAll(log, [ex.id], {}, NOW).blocks[0].exercises[0].sets;
    expect(ticked.every((x) => x.completedAt !== null && x.actualWeightKg === null && x.actualReps === 8)).toBe(true);
    expect(markAllQuestion(plan)).toEqual({ title: 'Tick 3 sets with these numbers?', message: '3 sets have no weight.' });
    expect(markAllQuestion({ tick: 1, skip: 0, noWeight: 1 }).message).toBe('1 set has no weight.');
    expect(markAllQuestion({ tick: 2, skip: 1, noWeight: 1 }).message).toBe(
      '1 set has no weight. 1 set has no numbers yet, so it stays unticked.',
    );
  });

  it('counts no weight only for weight and reps exercises', () => {
    let log = addLogExercise(emptyLog('Quick', uuid, NOW), { id: uuid(), name: 'Row', trackingType: 'weight_reps' }, uuid, NOW);
    const ex = log.blocks[0].exercises[0];
    log = updateActual(log, ex.sets[0].id, { actualReps: 8, actualWeightKg: 40 });
    expect(markAllPlan(log, [ex.id], {}).noWeight).toBe(0);
  });
});

describe('invalidAnnouncement', () => {
  it('speaks a box\'s reason once, when it becomes invalid or the reason changes', () => {
    expect(invalidAnnouncement(null, 'Whole reps only')).toBe('Whole reps only');
    expect(invalidAnnouncement('Whole reps only', 'Whole reps only')).toBeNull(); // still invalid: said already
    expect(invalidAnnouncement('Whole reps only', 'That’s more than a set can hold')).toBe('That’s more than a set can hold');
    expect(invalidAnnouncement('Whole reps only', null)).toBeNull(); // valid again: nothing to say
  });
});

describe('sheetDraft', () => {
  const saved = { feel: 'Good' as const, note: 'Saved note' };
  it('starts from the saved feeling and note when the sheet opens', () => {
    expect(sheetDraft({ wasVisible: false, visible: true, draft: { feel: null, note: 'old' }, saved })).toEqual(saved);
  });
  it('keeps what the client is typing when the saved note changes underneath', () => {
    const typing = { feel: null, note: 'Half a sent' };
    expect(sheetDraft({ wasVisible: true, visible: true, draft: typing, saved: { feel: 'Hard', note: 'From elsewhere' } })).toBe(typing);
  });
  it('leaves a closed sheet alone', () => {
    const draft = { feel: null, note: '' };
    expect(sheetDraft({ wasVisible: true, visible: false, draft, saved })).toBe(draft);
    expect(sheetDraft({ wasVisible: false, visible: false, draft, saved })).toBe(draft);
  });
});

describe('Auto progression on the phone', () => {
  /** One straight exercise, 3 × 8–10, with or without a weight typed by the coach. */
  const progressionLog = (targetWeightKg: number | null) =>
    startLogFromWorkout(
      WorkoutDoc.parse({
        id: uuid(),
        name: 'Push',
        notes: null,
        blocks: [
          {
            id: uuid(),
            kind: 'straight',
            exercises: [exercise('Bench Press', [1, 2, 3].map(() => set('normal', { targetRepsMin: 8, targetRepsMax: 10, targetWeightKg })))],
          },
        ],
      }),
      uuid,
      NOW,
    );
  const page = { kind: 'straight' as const, key: 'p', blockIndex: 0 };
  const lastFor = (log: WorkoutLogDoc): LastResults => ({
    [log.blocks[0].exercises[0].exerciseId]: {
      finishedAt: NOW,
      sets: [1, 2, 3].map(() => ({ setType: 'normal' as const, actualReps: 10, actualWeightKg: 135 * LB, actualDurationS: null, actualDistanceM: null })),
    },
  });
  const historyFor = (log: WorkoutLogDoc) => ({
    [log.blocks[0].exercises[0].exerciseId]: {
      region: 'upper' as const,
      sessions: [{ sets: [1, 2, 3].map(() => ({ setType: 'normal' as const, completed: true, reps: 10, weightKg: 135 * LB })) }],
    },
  });

  it('pre-fills the suggested weight and shows the hint', () => {
    const log = progressionLog(null);
    const model = buildPage(log, page, 'lb', lastFor(log), historyFor(log));
    if (model.kind !== 'straight') throw new Error('expected a straight page');
    expect(model.exercise.progression).toBe('Suggested 140 lb · ↑ +5 lb');
    expect(model.rows.map((r) => Math.round((r.values.weightKg ?? 0) / LB))).toEqual([140, 140, 140]);
    // "Last time" still shows what was actually lifted.
    expect(model.exercise.lastTime[0]?.actualWeightKg).toBeCloseTo(135 * LB);
  });

  it('changes nothing without history (Auto progression off)', () => {
    const log = progressionLog(null);
    const model = buildPage(log, page, 'lb', lastFor(log), {});
    if (model.kind !== 'straight') throw new Error('expected a straight page');
    expect(model.exercise.progression).toBeNull();
    expect(model.rows.map((r) => Math.round((r.values.weightKg ?? 0) / LB))).toEqual([135, 135, 135]);
  });

  it('lets a weight the coach typed win', () => {
    const log = progressionLog(150 * LB);
    const model = buildPage(log, page, 'lb', lastFor(log), historyFor(log));
    if (model.kind !== 'straight') throw new Error('expected a straight page');
    expect(model.exercise.progression).toBeNull();
    expect(model.rows.map((r) => Math.round((r.values.weightKg ?? 0) / LB))).toEqual([150, 150, 150]);
  });

  it('hides the suggestion when a set was ticked with another weight before the history loaded', () => {
    let log = progressionLog(null);
    const ex = log.blocks[0].exercises[0];
    // Ticked offline with last time's 135 lb; then the history arrives.
    log = completeSetWith(log, ex.sets[0].id, { reps: 10, weightKg: 135 * LB, durationS: null, distanceM: null }, NOW);
    const model = buildPage(log, page, 'lb', lastFor(log), historyFor(log));
    if (model.kind !== 'straight') throw new Error('expected a straight page');
    expect(model.exercise.progression).toBeNull();
    // The open sets carry the ticked weight forward, matching what the line (not) says.
    expect(model.rows.map((r) => Math.round((r.values.weightKg ?? 0) / LB))).toEqual([135, 135, 135]);
  });

  it('Mark all ticks with the suggested weight', () => {
    const log = progressionLog(null);
    const ex = log.blocks[0].exercises[0];
    const done = markAll(log, [ex.id], lastFor(log), NOW, { history: historyFor(log), units: 'lb' });
    expect(done.blocks[0].exercises[0].sets.map((s) => Math.round((s.actualWeightKg ?? 0) / LB))).toEqual([140, 140, 140]);
    expect(markAllPlan(log, [ex.id], lastFor(log), { history: historyFor(log), units: 'lb' })).toEqual({ tick: 3, skip: 0, noWeight: 0 });
  });
});

describe('deleting a set', () => {
  it('offers every set but the only one, named with its numbers', () => {
    const log = mockLog();
    const push = log.blocks[2].exercises[0];
    expect(deleteChoices(push, 'lb', []).map((c) => c.title)).toEqual([
      'Warm-up 1 · 35 lb × 12 reps',
      'Set 1 · 35 lb × 12 reps',
      'Drop set · 20 lb × 12 reps',
      'Drop set to failure · 15 lb',
    ]);
    const circles = log.blocks[0].exercises[0];
    expect(deleteChoices(circles, 'lb', [])).toEqual([]);
  });
});

describe('measurements: chosen columns, each side and tempo', () => {
  /** One straight exercise measuring `trackingType`, with every target the type uses. */
  function measuredLog(trackingType: string, over: Record<string, unknown> = {}): WorkoutLogDoc {
    const fields = {
      weight: { targetWeightKg: 20 },
      reps: { targetRepsMin: 10, targetRepsMax: 10 },
      time: { targetDurationS: 30 },
    };
    const uses = {
      weight_reps_time: ['weight', 'reps', 'time'],
      reps_time: ['reps', 'time'],
      weight: ['weight'],
      weight_reps: ['weight', 'reps'],
    }[trackingType] as Array<keyof typeof fields>;
    const targets: Record<string, unknown> = Object.assign(
      { targetWeightKg: null, targetRepsMin: null, targetRepsMax: null, targetDurationS: null },
      ...uses.map((u) => fields[u]),
    ) as Record<string, unknown>;
    const workout = WorkoutDoc.parse({
      id: uuid(),
      name: 'Measured',
      notes: null,
      sections: [],
      blocks: [
        {
          id: uuid(),
          sectionId: null,
          kind: 'straight',
          exercises: [{ ...exercise('Dumbbell Bench Press', [set('normal', targets), set('normal', targets)], trackingType), ...over }],
        },
      ],
    });
    return startLogFromWorkout(workout, uuid, NOW);
  }

  it('shows only the chosen measurements, with time next to reps and weight', () => {
    const heads = (tt: string, units: 'kg' | 'lb') => setRows(measuredLog(tt).blocks[0].exercises[0], units, [])[0].cells.map((c) => c.heading);
    expect(heads('weight_reps_time', 'lb')).toEqual(['LB', 'REPS', 'TIME']);
    expect(heads('reps_time', 'lb')).toEqual(['REPS', 'TIME']);
    expect(heads('weight', 'kg')).toEqual(['KG']);
    const row = setRows(measuredLog('weight_reps_time').blocks[0].exercises[0], 'kg', [])[0];
    expect(row.cells.map((c) => c.placeholder)).toEqual(['20', '10', '0:30']);
  });

  it('says EACH on weight and reps for an each-side exercise, as the shared setColumns does', () => {
    const ex = measuredLog('weight_reps_time', { eachSide: true }).blocks[0].exercises[0];
    const cells = setRows(ex, 'lb', [])[0].cells;
    expect(cells.map((c) => c.heading)).toEqual(['LB EACH', 'REPS EACH', 'TIME']);
    // A superset has no headings: the unit under each box says it instead.
    expect(cells.map((c) => c.unit)).toEqual(['lb each', 'reps each', 'm:ss']);
  });

  it('puts the Each side and Tempo badges and their help line on the page', () => {
    const log = measuredLog('weight_reps', { eachSide: true, tempo: '3-1-1-0' });
    const m = buildPage(log, buildSections(log)[0].pages[0], 'lb', {});
    if (m.kind !== 'straight') throw new Error('straight');
    expect(m.exercise.badges).toEqual(['Each side', 'Tempo 3-1-1-0']);
    expect(m.exercise.badgeHelp).toBe('Each side: the weight is per hand and the reps are per side. Tempo: seconds down, pause, up, pause.');
    const plain = measuredLog('weight_reps');
    const p = buildPage(plain, buildSections(plain)[0].pages[0], 'lb', {});
    expect(p.kind === 'straight' && p.exercise.badges).toEqual([]);
    expect(p.kind === 'straight' && p.exercise.badgeHelp).toBeNull();
  });

  it('logs a weight, reps and time set: typed time, then ✓ saves all three; it counts for volume', () => {
    let log = measuredLog('weight_reps_time');
    const ex = () => log.blocks[0].exercises[0];
    const typed = readTyped('duration', '0:45', 'kg', false);
    if (typed.kind !== 'ok') throw new Error('typed');
    log = updateActual(log, ex().sets[0].id, typed.patch);
    const row = setRows(ex(), 'kg', [])[0];
    expect(row.cells.map((c) => c.value)).toEqual(['', '', '0:45']);
    log = completeSetWith(log, row.setId, row.values, NOW);
    expect(ex().sets[0]).toMatchObject({ actualWeightKg: 20, actualReps: 10, actualDurationS: 45 });
    expect(LogSchema.safeParse(log).success).toBe(true);
    expect(logVolumeKg(log)).toBe(200);
    // Mark all names a weight, reps and time set that would go without a weight, as for weight and reps.
    log = updateActual(log, ex().sets[1].id, { actualWeightKg: null });
    const noTarget = measuredLog('weight_reps_time');
    const bare = { ...noTarget, blocks: [{ ...noTarget.blocks[0], exercises: [{ ...noTarget.blocks[0].exercises[0], sets: noTarget.blocks[0].exercises[0].sets.map((s) => ({ ...s, target: { ...s.target, weightKg: null } })) }] }] };
    expect(markAllPlan(bare, [bare.blocks[0].exercises[0].id], {}).noWeight).toBe(2);
  });
});

describe('the redesigned logger (approved Logger board)', () => {
  it('Start lands on the first set to do, the first page when all is done', () => {
    let log = mockLog();
    expect(startPlace(log, buildSections(log))).toEqual({ section: 0, page: 0 });
    log = tickAll(log, 0);
    expect(startPlace(log, buildSections(log))).toEqual({ section: 1, page: 0 });
    expect(startPlace(emptyLog('Quick', uuid, NOW), buildSections(emptyLog('Quick', uuid, NOW)))).toBeNull();
  });

  it('the header says the section, the exercise number, and the superset round', () => {
    let log = mockLog();
    const s = buildSections(log);
    expect(headerLines(log, s, { section: 0, page: 0 })).toEqual({ title: 'Parv - Upper/Core · Warm-Up', subtitle: 'Exercise 1 of 4 ▾' });
    expect(headerLines(log, s, { section: 1, page: 0 }).subtitle).toBe('Superset A · Round 1 of 4 ▾');
    log = tickAll(log, 1);
    expect(headerLines(log, buildSections(log), { section: 1, page: 1 }).subtitle).toBe('Exercise 3 of 4 ▾');
    expect(headerLines(log, s, { section: 2, page: 0 }).subtitle).toBe('Pick one · 4 of 4 ▾');
  });

  it('the bottom button names the next exercise, and Finish on the last page', () => {
    const log = mockLog();
    const s = buildSections(log);
    expect(nextAction(log, s, { section: 0, page: 0 })).toEqual({ kind: 'next', label: 'Next: A1 Dumbbell Bench Press', to: { section: 1, page: 0 } });
    expect(nextAction(log, s, { section: 1, page: 0 })).toMatchObject({ label: 'Next: Cable Tricep Pushdown' });
    expect(nextAction(log, s, { section: 1, page: 1 })).toMatchObject({ label: 'Next: Medicine Ball Slam, Farmers Walk or Overhead Throw' });
    expect(nextAction(log, s, { section: 2, page: 0 })).toEqual({ kind: 'finish' });
  });

  it('Today says what is next: in a superset the exercise of its next set', () => {
    let log = tickAll(mockLog(), 0);
    log = completeSet(log, log.blocks[1].exercises[0].sets[0].id, NOW);
    expect(nextUpLabel(log)).toBe('A2 Alternating DB Curl');
  });

  it('counts the unticked sets a page leaves behind', () => {
    let log = mockLog();
    const s = buildSections(log);
    expect(openSetsOnPage(log, s[1].pages[1]).count).toBe(4);
    log = completeSet(log, log.blocks[2].exercises[0].sets[0].id, NOW);
    expect(openSetsOnPage(log, s[1].pages[1])).toEqual({ count: 3, logExerciseIds: [log.blocks[2].exercises[0].id] });
    expect(openSetsOnPage(log, s[2].pages[0]).count).toBe(2);
    expect(notTickedTitle(2)).toBe('2 sets not ticked');
    expect(notTickedTitle(1)).toBe('1 set not ticked');
  });

  it('shows last time per set without units, and time in', () => {
    const l = { setType: 'normal' as const, actualReps: 8, actualWeightKg: 57.5, actualDurationS: null, actualDistanceM: null };
    expect(lastCellText(l, 'weight_reps', 'kg')).toBe('57.5 × 8');
    expect(lastCellText(null, 'weight_reps', 'kg')).toBeNull();
    const log = mockLog();
    const push = log.blocks[2].exercises[0];
    const rows = setRows(push, 'kg', [], undefined, [
      { setType: 'warmup', actualReps: 10, actualWeightKg: 20, actualDurationS: null, actualDistanceM: null },
      l,
    ]);
    expect(rows.map((r) => r.last)).toEqual(['20 × 10', '57.5 × 8', null, null]);
    expect(elapsedLabel(NOW, Date.parse(NOW) + 12 * 60_000 + 5000)).toBe('12 min in');
    // Nothing under a minute.
    expect(elapsedLabel(NOW, Date.parse(NOW) + 20_000)).toBe('');
    expect(elapsedLabel(NOW, Date.parse(NOW) + 65 * 60_000)).toBe('1 h 5 min in');
  });

  it('a bodyweight exercise asks for added weight, optional', () => {
    const doc = WorkoutDoc.parse({
      id: uuid(),
      name: 'Pull',
      notes: null,
      blocks: [{ id: uuid(), kind: 'straight', exercises: [exercise('Pull Up', [set('normal', { targetWeightKg: null, targetRepsMin: 8, targetRepsMax: 8 })])] }],
    });
    const log = startLogFromWorkout(doc, uuid, NOW);
    expect(setRows(log.blocks[0].exercises[0], 'kg', [])[0].cells.map((c) => c.placeholder)).toEqual(['+ kg', '8']);
  });
});

describe('the superset page (approved SS1–SS5 boards)', () => {
  const T = (m: number) => `2026-11-06T10:${String(m).padStart(2, '0')}:00.000Z`;
  const tickAt = (log: WorkoutLogDoc, setId: string, lb: number, reps: number, minute: number) =>
    completeSetWith(log, setId, { weightKg: lb * LB, reps, durationS: null, distanceM: null }, T(minute));
  const superset = (log: WorkoutLogDoc): SupersetPageModel => {
    const m = buildPage(log, buildSections(log)[1].pages[0], 'lb', {});
    if (m.kind !== 'superset') throw new Error('superset');
    return m;
  };
  const a = (log: WorkoutLogDoc, i: number) => log.blocks[1].exercises[0].sets[i].id;
  const b = (log: WorkoutLogDoc, i: number) => log.blocks[1].exercises[1].sets[i].id;

  it('the header and the outline follow the set after the last tick, not the first open one', () => {
    let log = mockLog();
    log = tickAt(log, a(log, 0), 45, 12, 1);
    log = tickAt(log, b(log, 0), 15, 12, 2);
    log = tickAt(log, a(log, 1), 55, 10, 3);
    // B2 of round 2 skipped; A1 of round 3 ticked.
    log = tickAt(log, a(log, 2), 60, 6, 4);
    const m = superset(log);
    expect(m.currentRound).toBe(3);
    expect(headerLines(log, buildSections(log), { section: 1, page: 0 }).subtitle).toBe('Superset A · Round 3 of 4 ▾');
    expect(m.rounds.map((r) => r.kind)).toEqual(['done', 'partial', 'current', 'future']);
    expect(m.rounds[1].summary).toBe('1 left');
    // The outline is on B2 of round 3.
    expect(m.rounds[2].entries.map((e) => e.rows[0].current)).toEqual([false, true]);
    // Going back to tick the leftover moves the cursor on from there (round 3's B2), not back to round 2.
    log = tickAt(log, b(log, 1), 15, 12, 5);
    expect(superset(log).currentRound).toBe(3);
    expect(superset(log).rounds.map((r) => r.kind)).toEqual(['done', 'done', 'current', 'future']);
  });

  it('a round folds and opens by tap; a partly done round starts open, the current one always is', () => {
    const done = { round: 1, kind: 'done' as const };
    const partial = { round: 2, kind: 'partial' as const };
    const current = { round: 3, kind: 'current' as const };
    let fold = {};
    expect(isRoundOpen(fold, done)).toBe(false);
    expect(isRoundOpen(fold, partial)).toBe(true);
    expect(isRoundOpen(fold, current)).toBe(true);
    fold = toggleRound(fold, done);
    expect(isRoundOpen(fold, done)).toBe(true);
    fold = toggleRound(fold, done);
    expect(isRoundOpen(fold, done)).toBe(false);
    fold = toggleRound(fold, partial);
    expect(isRoundOpen(fold, partial)).toBe(false);
    expect(isRoundOpen(toggleRound(fold, current), current)).toBe(true);
  });

  it('a folded round sums up each set, a drop as "+↓"', () => {
    let log = mockLog();
    log = tickAt(log, a(log, 0), 45, 12, 1);
    log = tickAt(log, b(log, 0), 15, 12, 2);
    expect(superset(log).rounds[0].summary).toBe('45 × 12 · 15 × 12');
    // Round 3: A1 60 × 6, then a drop at 45 × 8, then B 20 × 12.
    log = tickAt(log, a(log, 2), 60, 6, 3);
    log = addDropSet(log, log.blocks[1].exercises[0].id, a(log, 2), 'drop-1', 'lb', [], T(3));
    log = tickAt(log, 'drop-1', 45, 8, 4);
    log = tickAt(log, b(log, 2), 20, 12, 5);
    const block = log.blocks[1];
    const round3 = supersetRounds(block)[2];
    expect(roundSummary(block, round3.entries, 'lb')).toBe('60 × 6 +↓ 45 × 8 · 20 × 12');
    expect(superset(log).rounds[2]).toMatchObject({ kind: 'done', summary: '60 × 6 +↓ 45 × 8 · 20 × 12' });
  });

  it('+ Add round tops every exercise up to the longest, then adds one each', () => {
    let log = mockLog();
    expect(log.blocks[1].exercises.map((e) => e.sets.length)).toEqual([4, 3]);
    log = addRound(log, log.blocks[1].id, uuid, NOW);
    expect(log.blocks[1].exercises.map((e) => e.sets.length)).toEqual([5, 5]);
    expect(superset(log).totalRounds).toBe(5);
    expect(supersetRounds(log.blocks[1]).map((r) => r.entries.length)).toEqual([2, 2, 2, 2, 2]);
  });

  it('the intro says the rest once; rounds that rest differently say it each', () => {
    const log = mockLog();
    expect(superset(log).intro).toBe('Back to back, then rest 1:00');
    const firstSet = log.blocks[1].exercises[1].sets[0].id;
    const varied: WorkoutLogDoc = {
      ...log,
      blocks: log.blocks.map((bl) => ({
        ...bl,
        exercises: bl.exercises.map((e) => ({ ...e, sets: e.sets.map((x) => (x.id === firstSet ? { ...x, target: { ...x.target, restSeconds: 90 } } : x)) })),
      })),
    };
    const m = superset(varied);
    expect(m.intro).toBe('Back to back');
    expect(m.rounds[0].restLine).toBe('Rest 1:30');
    expect(m.rounds[1].restLine).toBe('Rest 1:00');
  });

  it('a drop set starts at 75% of the set above, rounded down to the plate step', () => {
    let log = mockLog();
    const bench = log.blocks[1].exercises[0].id;
    const curl = log.blocks[1].exercises[1].id;
    const weightLb = (l: WorkoutLogDoc, id: string) => {
      const kg = l.blocks.flatMap((x) => x.exercises).flatMap((e) => e.sets).find((x) => x.id === id)?.actualWeightKg;
      return kg == null ? null : Math.round((kg / LB) * 100) / 100;
    };
    log = tickAt(log, a(log, 0), 60, 6, 1);
    log = tickAt(log, b(log, 0), 15, 12, 2);
    const d1 = addDropSet(log, bench, a(log, 0), 'd1', 'lb', [], NOW);
    expect(weightLb(d1, 'd1')).toBe(45);
    // The drop sits right after its set, as a drop.
    expect(d1.blocks[1].exercises[0].sets.map((x) => x.setType)).toEqual(['normal', 'drop', 'normal', 'normal', 'normal']);
    expect(weightLb(addDropSet(log, curl, b(log, 0), 'd2', 'lb', [], NOW), 'd2')).toBe(10);
    // Not done yet: from the planned weight (45 lb → 33.75 → 30).
    expect(weightLb(addDropSet(log, bench, a(log, 1), 'd3', 'lb', [], NOW), 'd3')).toBe(30);
    // A second drop goes on from the first (45 → 33.75 → 30).
    expect(weightLb(addDropSet(d1, bench, 'd1', 'd4', 'lb', [], NOW), 'd4')).toBe(30);
    // kg: 30 kg → 22.5 kg.
    const kgBase = mockLog();
    const kgLog = completeSetWith(kgBase, a(kgBase, 0), { weightKg: 30, reps: 8, durationS: null, distanceM: null }, NOW);
    const kgBench = kgLog.blocks[1].exercises[0];
    const withKgDrop = addDropSet(kgLog, kgBench.id, kgBench.sets[0].id, 'd5', 'kg', [], NOW);
    const drop = withKgDrop.blocks[1].exercises[0].sets[1];
    expect(drop).toMatchObject({ id: 'd5', setType: 'drop' });
    expect(drop.actualWeightKg).toBeCloseTo(22.5, 6);
  });

  it('no drop on a warm-up, and none with weight for a reps-only exercise', () => {
    const log = mockLog();
    const push = log.blocks[2].exercises[0];
    expect(addDropSet(log, push.id, push.sets[0].id, 'x', 'lb', [], NOW)).toBe(log);
    const arms = log.blocks[0].exercises[0];
    expect(setRows(arms, 'lb', [])[0].canDrop).toBe(false);
    expect(setRows(push, 'lb', []).map((r) => r.canDrop)).toEqual([false, true, true, true]);
  });

  it('a drop is never heavier than its set: none when 75% is under one plate step', () => {
    let log = mockLog();
    const bench = log.blocks[1].exercises[0];
    log = tickAt(log, a(log, 0), 5, 12, 1);
    const ex = log.blocks[1].exercises[0];
    expect(dropPlan(ex, a(log, 0), 'lb', [])).toBeNull();
    expect(setRows(ex, 'lb', [])[0].canDrop).toBe(false);
    expect(addDropSet(log, bench.id, a(log, 0), 'x', 'lb', [], NOW)).toBe(log);
    // A planned 45 lb set still can.
    expect(dropPlan(ex, a(log, 1), 'lb', [])).not.toBeNull();
  });

  it('the exercise ··· "Add drop set" follows the last ticked set, else the outlined one, else the last', () => {
    let log = mockLog();
    const block = () => log.blocks[1];
    // Nothing ticked: the outline is on A1's first set.
    expect(exerciseDropSetId(block(), block().exercises[0])).toBe(a(log, 0));
    // A2 is not under the outline: its last working set.
    expect(exerciseDropSetId(block(), block().exercises[1])).toBe(b(log, 2));
    log = tickAt(log, a(log, 0), 45, 12, 1);
    log = tickAt(log, a(log, 1), 55, 10, 3);
    log = tickAt(log, b(log, 0), 15, 12, 2);
    expect(exerciseDropSetId(block(), block().exercises[0])).toBe(a(log, 1));
    expect(exerciseDropSetId(block(), block().exercises[1])).toBe(b(log, 0));
  });

  it('the menus: the exercise ··· in the approved order, the set ··· with Add drop set above Delete set', () => {
    const log = mockLog();
    const bench = log.blocks[1].exercises[0];
    expect(exerciseMenu(bench, { coachName: 'Demo', hasLastTime: true, deletable: true, canDrop: true }).map((m) => m.title)).toEqual([
      'Note for Demo',
      'Last time',
      'How to do it',
      'Add set',
      'Add drop set',
      'Delete set',
      'Remove exercise',
    ]);
    const arms = log.blocks[0].exercises[0];
    expect(exerciseMenu(arms, { coachName: null, hasLastTime: false, deletable: false, canDrop: false }).map((m) => m.title)).toEqual([
      'Note for your coach',
      'How to do it',
      'Add set',
      'Remove exercise',
    ]);
    const rows = setRows(bench, 'lb', []);
    expect(setMenu(rows[0]).map((m) => m.title)).toEqual(['Add drop set', 'Delete set']);
    expect(setMenu(setRows(arms, 'lb', [])[0])).toEqual([]);
  });

  it('each exercise says last time with its units, and nothing the first time', () => {
    const log = mockLog();
    const bench = log.blocks[1].exercises[0];
    const last: LastResults = {
      [bench.exerciseId]: { finishedAt: NOW, sets: [{ setType: 'normal', actualReps: 10, actualWeightKg: 55 * LB, actualDistanceM: null, actualDurationS: null }] },
    };
    const m = buildPage(log, buildSections(log)[1].pages[0], 'lb', last);
    expect(m.kind === 'superset' && m.exercises.map((e) => e.lastLine)).toEqual(['Last: 55 lb × 10', null]);
  });
});
