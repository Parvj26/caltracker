import {
  WorkoutDoc,
  addSubstitute,
  chooseSubstitute,
  completeSet,
  completeSetWith,
  addLogExercise,
  emptyLog,
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
  it('turns sections into start pages and pages: a superset is one page, each pick-one option is a page', () => {
    const sections = buildSections(mockLog());
    expect(sections.map((s) => s.title)).toEqual(['Warm-Up', 'Resistance Training', 'Finisher']);
    expect(sections.map((s) => s.countLine)).toEqual(['1 exercise', '1 superset · 3 exercises', 'Pick one of 3 · swipe to choose']);
    expect(sections[1].pages.map((p) => p.kind)).toEqual(['superset', 'straight']);
    expect(sections[1].pages[0]).toMatchObject({ kind: 'superset', number: 1 });
    expect(sections[2].pages.map((p) => p.kind === 'option' && `${p.optionIndex + 1}/${p.options}`)).toEqual(['1/3', '2/3', '3/3']);
  });

  it('a workout without sections is one section named after the workout; an empty log still has one', () => {
    const log = mockLog();
    const plain = { ...log, sections: [], blocks: log.blocks.map((b) => ({ ...b, sectionId: null })) };
    const sections = buildSections(plain);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBeNull();
    expect(sections[0].title).toBe('Parv - Upper/Core');
    expect(sections[0].pages).toHaveLength(2 + 1 + 3);
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
    // From any option of a pick-one group, Done skips the other options.
    expect(afterDone(s, { section: 2, page: 0 })).toEqual({ kind: 'finish' });
    expect(afterDone(s, { section: 2, page: 1 })).toEqual({ kind: 'finish' });
  });

  it('steps one page back or forward across sections, without Done (options one by one)', () => {
    const s = buildSections(mockLog());
    expect(stepPlace(s, { section: 0, page: 0 }, -1)).toBeNull();
    expect(stepPlace(s, { section: 0, page: 0 }, 1)).toEqual({ section: 1, page: 0 });
    expect(stepPlace(s, { section: 1, page: 0 }, -1)).toEqual({ section: 0, page: 0 });
    expect(stepPlace(s, { section: 1, page: 0 }, 1)).toEqual({ section: 1, page: 1 });
    expect(stepPlace(s, { section: 1, page: 1 }, 1)).toEqual({ section: 2, page: 0 });
    // Back from a section's first page lands on the previous section's last page.
    expect(stepPlace(s, { section: 2, page: 0 }, -1)).toEqual({ section: 1, page: 1 });
    expect(stepPlace(s, { section: 2, page: 0 }, 1)).toEqual({ section: 2, page: 1 });
    expect(stepPlace(s, { section: 2, page: 2 }, 1)).toBeNull();
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
    expect(stepLabel(s, { section: 2, page: 1 }, -1)).toBe('Previous page');
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
    expect(steps).toBe(6); // 1 + 2 + 3 pages, then the end
    expect(JSON.stringify(log)).toBe(before);
    expect(finishModel(log).done).toBe(0);
  });

  it('resumes at the first open page, and at the picked option of a pick-one group', () => {
    let log = mockLog();
    expect(resumePlace(log, buildSections(log))).toEqual({ section: 0, page: 0 });
    log = tickAll(tickAll(tickAll(log, 0), 1), 2);
    expect(resumePlace(log, buildSections(log))).toEqual({ section: 2, page: 0 });
    log = pickChoice(log, log.blocks[3].id, log.blocks[3].exercises[1].id, NOW);
    expect(resumePlace(log, buildSections(log))).toEqual({ section: 2, page: 1 });
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
    expect(main[1].kind === 'straight' && main[1].item.count).toBe('×2');
    const fin = startGroups(log, s[2], 'lb');
    expect(fin[0].kind === 'choice' && fin[0].items.map((i) => i.name)).toEqual(['Medicine Ball Slam', 'Farmers Walk', 'Overhead Throw']);
    expect(startGroups(log, s[0], 'lb')[0]).toMatchObject({ kind: 'straight', item: { summary: '10 reps', count: '×1', substitute: null } });
  });
});

describe('set rows', () => {
  it('columns follow the tracking type; warm-up W, drop D, failure F', () => {
    const log = mockLog();
    const push = log.blocks[2].exercises[0];
    const rows = setRows(push, 'lb', []);
    expect(rows.map((r) => r.tag)).toEqual(['W', '1', 'D', 'F']);
    expect(rows.map((r) => r.tagKind)).toEqual(['warmup', 'normal', 'drop', 'failure']);
    expect(rows[3].cells[0].placeholder).toBe('15');
    expect(rows.map((r) => r.name)).toEqual(['Warm-up 1', 'Set 1', 'Drop set', 'Drop set to failure']);
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
    expect(m.kind === 'superset' && m.heading).toBe('Superset 1');
    expect(m.kind === 'superset' && m.rounds.map((r) => r.heading)).toEqual(['Round 1 of 4', 'Round 2 of 4', 'Round 3 of 4', 'Round 4 of 4']);
    expect(m.kind === 'superset' && m.exercises.map((e) => e.label)).toEqual(['A1', 'A2']);
    expect(m.kind === 'superset' && m.rounds[0].restLine).toBe('Rest 1:00 after the round');
    log = completeSet(log, block.exercises[0].sets[0].id, NOW);
    log = completeSet(log, block.exercises[1].sets[0].id, NOW);
    m = buildPage(log, page, 'lb', {});
    // The title stays "Superset 1"; round 1 is ticked off under it and round 2 is the current one.
    expect(m.kind === 'superset' && m.heading).toBe('Superset 1');
    expect(m.kind === 'superset' && m.currentRound).toBe(2);
    expect(m.kind === 'superset' && m.rounds.map((r) => r.heading)).toEqual(['Round 1 of 4 ✓', 'Round 2 of 4', 'Round 3 of 4', 'Round 4 of 4']);
    expect(m.kind === 'superset' && m.rounds[0].done).toBe(true);
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

  it('a pick-one option says whether it is the one being done, and locks out the others after a tick', () => {
    let log = mockLog();
    const fin = buildSections(log)[2];
    const block = log.blocks[3];
    expect(buildPage(log, fin.pages[1], 'lb', {})).toMatchObject({ kind: 'option', line: 'Option 2 of 3 · log a set to pick it', picked: false });
    log = pickingFirst(log, block.id, block.exercises[1].id, NOW);
    expect(buildPage(log, fin.pages[1], 'lb', {})).toMatchObject({ line: "Option 2 of 3 · you’re doing this one", picked: true });
    // Picked but nothing ticked: another option can still take over.
    expect(pickingFirst(log, block.id, block.exercises[0].id, NOW).blocks[3].pickedExerciseId).toBe(block.exercises[0].id);
    log = completeSet(log, block.exercises[1].sets[0].id, NOW);
    expect(pickingFirst(log, block.id, block.exercises[0].id, NOW)).toBe(log);
    expect(buildPage(log, fin.pages[0], 'lb', {})).toMatchObject({ lockedOut: "You’re doing Farmers Walk. Swipe to it to log it." });
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
      headline: '12 of 14 sets done.',
      unticked: "2 sets of Cable Tricep Pushdown aren’t ticked; they’ll be saved as not done.",
      noneDone: false,
    });
  });

  it('counts a pick-one group not picked yet as its first option, then only the picked option', () => {
    let log = tickAll(tickAll(tickAll(mockLog(), 0), 1), 2);
    expect(finishModel(log)).toMatchObject({ total: 1 + 7 + 4 + 2, unticked: "2 sets aren’t ticked; they’ll be saved as not done." });
    const block = log.blocks[3];
    log = pickChoice(log, block.id, block.exercises[2].id, NOW);
    expect(finishModel(log).unticked).toBe("2 sets of Overhead Throw aren’t ticked; they’ll be saved as not done.");
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
    expect(markAllPlan(log, [ex.id], {})).toEqual({ tick: 3, skip: 0 });
    const blank = addLogExercise(emptyLog('Quick', uuid, NOW), { id: uuid(), name: 'Row', trackingType: 'weight_reps' }, uuid, NOW);
    const bex = blank.blocks[0].exercises[0];
    expect(markAllPlan(blank, [bex.id], {})).toEqual({ tick: 0, skip: 3 });
    expect(markAll(blank, [bex.id], {}, NOW)).toBe(blank);
    expect(markAllQuestion({ tick: 4, skip: 0 })).toEqual({ title: 'Tick 4 sets with these numbers?', message: null });
    expect(markAllQuestion({ tick: 2, skip: 1 }).message).toBe('1 set has no numbers yet, so it stays unticked.');
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
