// What the logging screens show, worked out from the log. Pure (no React): the components only draw it.
//
// The workout is a list of SECTIONS (the coach's sections; a workout without sections is one unnamed section).
// Each section opens with a "Start section" page, then its PAGES, swiped left and right:
//   * a straight exercise is one page,
//   * a superset is one page (all its exercises, round by round),
//   * a pick-one group is one page per option (logging an option picks it).
// Every rule (pre-fill, pick-one, rounds, drops, counting) comes from @caltracker/shared; this file only lays it out.
import {
  TARGET_FIELDS,
  blockRoundCount,
  completeSetWith,
  completedSetCount,
  currentStep,
  distanceUnitFor,
  formatClock,
  formatResult,
  formatSetsSummary,
  fromMeters,
  groupDropSets,
  isSubstituteLocked,
  otherSubstituteOptions,
  substituteChoices,
  substitutedFrom,
  isBlockDone,
  isChoiceLocked,
  kgToInput,
  liveExercises,
  needsPick,
  openSetCount,
  pickChoice,
  resolveSetValues,
  roundRestSeconds,
  sectionRuns,
  toKg,
  toMeters,
  type ActualPatch,
  type LogBlockDoc,
  type LogExerciseDoc,
  type LogSetDoc,
  type SetValues,
  type StepField,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import type { LastResultSet, LastResults } from './log-api';
import { orList, supersetLetters } from './workouts';

// ---------------------------------------------------------------------------------------------------------------
// Sections and pages

export type FlowPage =
  | { kind: 'straight'; key: string; blockIndex: number }
  | { kind: 'superset'; key: string; blockIndex: number; /** 1-based among the section's supersets. */ number: number }
  | { kind: 'option'; key: string; blockIndex: number; optionIndex: number; options: number };

export type FlowSection = {
  key: string;
  /** The coach's section name; null for a workout without sections (or exercises added after the last section). */
  name: string | null;
  /** What the header and the start page call it: the section name, else the workout's name. */
  title: string;
  blockIndexes: number[];
  pages: FlowPage[];
  /** "1 exercise", "3 supersets · 6 exercises", "Pick one of 3 · swipe to choose". */
  countLine: string;
  /** Every page done (a pick-one group counts once it is picked and its sets are ticked). */
  done: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countLine(blocks: readonly LogBlockDoc[]): string {
  if (blocks.length === 1 && blocks[0].kind === 'choice') {
    return `Pick one of ${blocks[0].exercises.length} · swipe to choose`;
  }
  const supersets = blocks.filter((b) => b.kind === 'superset').length;
  const exercises = blocks.reduce((n, b) => n + (b.kind === 'choice' ? 1 : b.exercises.length), 0);
  const parts = [supersets > 0 ? plural(supersets, 'superset') : null, plural(exercises, 'exercise')];
  if (blocks.some((b) => b.kind === 'choice')) parts.push('pick one');
  return parts.filter((p): p is string => p !== null).join(' · ');
}

/** The pages of the blocks given (in order): one per straight block and superset, one per pick-one option. */
function pagesOf(log: WorkoutLogDoc, blockIndexes: readonly number[]): FlowPage[] {
  const pages: FlowPage[] = [];
  let supersets = 0;
  for (const bi of blockIndexes) {
    const block = log.blocks[bi];
    if (block.kind === 'superset') {
      supersets += 1;
      pages.push({ kind: 'superset', key: block.id, blockIndex: bi, number: supersets });
    } else if (block.kind === 'choice') {
      block.exercises.forEach((ex, oi) =>
        pages.push({ kind: 'option', key: ex.id, blockIndex: bi, optionIndex: oi, options: block.exercises.length }),
      );
    } else {
      pages.push({ kind: 'straight', key: block.id, blockIndex: bi });
    }
  }
  return pages;
}

/** The workout's sections in order. An empty log (an unplanned workout before its first exercise) has one. */
export function buildSections(log: WorkoutLogDoc): FlowSection[] {
  const runs = sectionRuns(log.blocks, log.sections);
  if (runs.length === 0) {
    return [{ key: 'none-0', name: null, title: log.name, blockIndexes: [], pages: [], countLine: plural(0, 'exercise'), done: false }];
  }
  return runs.map((run, r) => {
    const blocks = run.blockIndexes.map((i) => log.blocks[i]);
    const name = run.section?.name ?? null;
    return {
      key: run.section ? `${run.section.id}-${r}` : `none-${r}`,
      name,
      title: name ?? (runs.length === 1 ? log.name : 'More exercises'),
      blockIndexes: run.blockIndexes,
      pages: pagesOf(log, run.blockIndexes),
      countLine: countLine(blocks),
      done: blocks.every(isBlockDone),
    };
  });
}

export type FlowPlace = { section: number; page: number };

/** Where a page is now, after the log changed: found again by its key, else the same spot (clamped). */
export function placeAfterChange(sections: readonly FlowSection[], prev: { sectionKey: string; pageKey: string | null; at: FlowPlace }): FlowPlace {
  for (let s = 0; s < sections.length; s += 1) {
    const p = prev.pageKey === null ? -1 : sections[s].pages.findIndex((x) => x.key === prev.pageKey);
    if (p >= 0) return { section: s, page: p };
  }
  const s = sections.findIndex((x) => x.key === prev.sectionKey);
  const section = s >= 0 ? s : Math.min(prev.at.section, sections.length - 1);
  const pages = sections[section]?.pages.length ?? 0;
  return { section: Math.max(0, section), page: Math.max(0, Math.min(prev.at.page, pages - 1)) };
}

/** True when a page still has something to tick (an unpicked pick-one group counts as open). */
export function isPageOpen(log: WorkoutLogDoc, page: FlowPage): boolean {
  const block = log.blocks[page.blockIndex];
  if (!block) return false;
  if (page.kind === 'option') {
    if (needsPick(block)) return true;
    return block.pickedExerciseId === block.exercises[page.optionIndex]?.id && !isBlockDone(block);
  }
  return !isBlockDone(block);
}

/** Where the workout picks up: the first open page (a pick-one group at its picked option), else null. */
export function resumePlace(log: WorkoutLogDoc, sections: readonly FlowSection[]): FlowPlace | null {
  for (let s = 0; s < sections.length; s += 1) {
    const pages = sections[s].pages;
    for (let p = 0; p < pages.length; p += 1) {
      const page = pages[p];
      const block = log.blocks[page.blockIndex];
      if (isBlockDone(block)) continue;
      if (page.kind === 'option' && block.pickedExerciseId !== null) {
        const at = pages.findIndex((x) => x.kind === 'option' && x.blockIndex === page.blockIndex && block.exercises[x.optionIndex]?.id === block.pickedExerciseId);
        return { section: s, page: at >= 0 ? at : p };
      }
      return { section: s, page: p };
    }
  }
  return null;
}

export type AfterDone = { kind: 'page'; page: number } | { kind: 'section'; section: number } | { kind: 'finish' };

/**
 * Where Done goes: the next page of the section; from a pick-one option, past the group's other options (the
 * client has chosen); after the section's last page, the next section's start page; after the last section, the
 * finish sheet.
 */
export function afterDone(sections: readonly FlowSection[], at: FlowPlace): AfterDone {
  const pages = sections[at.section]?.pages ?? [];
  const here = pages[at.page];
  let next = at.page + 1;
  if (here?.kind === 'option') {
    while (next < pages.length && pages[next].kind === 'option' && pages[next].blockIndex === here.blockIndex) next += 1;
  }
  if (next < pages.length) return { kind: 'page', page: next };
  if (at.section + 1 < sections.length) return { kind: 'section', section: at.section + 1 };
  return { kind: 'finish' };
}

// ---------------------------------------------------------------------------------------------------------------
// The "Start section" list and the workout overview

export type StartItem = {
  logExerciseId: string;
  exerciseId: string;
  name: string;
  /** "35 lb × 12, 45 lb × 12" (the coach's targets). */
  summary: string;
  /** "×4": warm-up and working sets (a drop continues its set). */
  count: string;
  /** "or: Machine Assisted Pull Up" when the coach added a substitute. */
  substitute: string | null;
  done: boolean;
};

export type StartGroup =
  | { kind: 'straight'; key: string; item: StartItem }
  | { kind: 'superset'; key: string; items: StartItem[] }
  | { kind: 'choice'; key: string; items: StartItem[] };

/** A log set as the plan's set, so the preview's one-line summary words it exactly the same. */
const asPlanSet = (s: Pick<LogSetDoc, 'setType' | 'target'>, i: number) => ({
  id: String(i),
  setType: s.setType,
  targetRepsMin: s.target.repsMin,
  targetRepsMax: s.target.repsMax,
  targetWeightKg: s.target.weightKg,
  targetDurationS: s.target.durationS,
  targetDistanceM: s.target.distanceM,
  toFailure: s.target.toFailure,
  restSeconds: s.target.restSeconds ?? 0,
  note: null,
});

export type SubstituteModel = {
  /** "Machine Assisted Pull Up" (or "A or B"): the options not being done now. */
  otherNames: string;
  /** The planned exercise's name while a substitute is being done, else null. */
  doingInsteadOf: string | null;
  /** A set is ticked: the choice can no longer change. */
  locked: boolean;
};

/** The coach-added substitutes of an exercise, or null when it has none. */
export function substituteOf(ex: LogExerciseDoc): SubstituteModel | null {
  const others = otherSubstituteOptions(ex);
  if (others.length === 0) return null;
  return {
    otherNames: orList(others.map((o) => o.exerciseName)),
    doingInsteadOf: substitutedFrom(ex)?.exerciseName ?? null,
    locked: isSubstituteLocked(ex),
  };
}

export type SubstituteCard = {
  substituteId: string | null;
  /** "Planned" or "Substitute". */
  kind: string;
  name: string;
  /** The option's planned sets in one line ("85 lb × 12, 115 lb × 12"). */
  summary: string;
  chosen: boolean;
};

/** The cards of the "Which one are you doing?" sheet: the planned exercise first, then the coach's substitutes. */
export function substituteCards(ex: LogExerciseDoc, units: Units): SubstituteCard[] {
  return substituteChoices(ex).map((c) => {
    const option = ex.substituteOptions.find((o) => o.substituteId === c.substituteId)!;
    return {
      substituteId: c.substituteId,
      kind: c.planned ? 'Planned' : 'Substitute',
      name: c.exerciseName,
      summary: formatSetsSummary(option.sets.map(asPlanSet), option.trackingType, units).text,
      chosen: c.chosen,
    };
  });
}

function startItem(ex: LogExerciseDoc, units: Units): StartItem {
  const summary = formatSetsSummary(ex.sets.map(asPlanSet), ex.trackingType, units);
  const sub = substituteOf(ex);
  return {
    logExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    name: ex.exerciseName,
    summary: summary.text,
    count: `×${summary.count}`,
    substitute: sub ? `or: ${sub.otherNames}` : null,
    done: ex.sets.every((s) => s.completedAt !== null),
  };
}

export function startGroups(log: WorkoutLogDoc, section: FlowSection, units: Units): StartGroup[] {
  return section.blockIndexes.map((bi) => {
    const block = log.blocks[bi];
    const items = block.exercises.map((ex) => startItem(ex, units));
    if (block.kind === 'superset') return { kind: 'superset', key: block.id, items };
    if (block.kind === 'choice') return { kind: 'choice', key: block.id, items };
    return { kind: 'straight', key: block.id, item: items[0] };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Set rows

export type CellModel = {
  field: StepField;
  /** Column heading on a straight page ("LB", "REPS", "TIME", "MI"). */
  heading: string;
  /** The unit as words under a superset's cell ("lb", "reps", "m:ss", "mi"). */
  unit: string;
  /** What is stored, as the box shows it ("" when nothing is typed yet). */
  value: string;
  /** What ✓ would save (the pre-fill), shown greyed in an empty box. */
  placeholder: string;
};

export type RowTag = 'normal' | 'warmup' | 'drop' | 'failure';

export type RowModel = {
  setId: string;
  setIndex: number;
  /** "1", "W", "D" or "F" (a drop to failure): the first column. */
  tag: string;
  tagKind: RowTag;
  /** "Set 2", "Warm-up 1", "Drop set": for screen readers. */
  name: string;
  done: boolean;
  cells: CellModel[];
  /** What ✓ saves into the actuals still empty. */
  values: SetValues;
};

const FIELD_ORDER: readonly StepField[] = ['weight', 'reps', 'duration', 'distance'];

function cellFor(field: StepField, set: LogSetDoc, values: SetValues, units: Units): CellModel {
  switch (field) {
    case 'weight': {
      const show = (v: number | null) => (v === null ? '' : String(kgToInput(v, units)));
      return { field, heading: units.toUpperCase(), unit: units, value: show(set.actualWeightKg), placeholder: show(values.weightKg) };
    }
    case 'reps': {
      const show = (v: number | null) => (v === null ? '' : String(v));
      return { field, heading: 'REPS', unit: 'reps', value: show(set.actualReps), placeholder: show(values.reps) };
    }
    case 'duration': {
      const show = (v: number | null) => (v === null ? '' : formatClock(v));
      return { field, heading: 'TIME', unit: 'm:ss', value: show(set.actualDurationS), placeholder: show(values.durationS) };
    }
    case 'distance': {
      const unit = distanceUnitFor(units);
      const show = (v: number | null) => (v === null ? '' : String(fromMeters(v, unit)));
      return { field, heading: unit.toUpperCase(), unit, value: show(set.actualDistanceM), placeholder: show(values.distanceM) };
    }
  }
}

/** The fields a tracking type logs, weight first ("135 × 8"). */
export function fieldsFor(ex: Pick<LogExerciseDoc, 'trackingType'>): StepField[] {
  const keep = TARGET_FIELDS[ex.trackingType] as readonly string[];
  return FIELD_ORDER.filter((f) => keep.includes(f));
}

/** One row per set of the exercise, or only the sets at `setIndexes` (a superset round). */
export function setRows(ex: LogExerciseDoc, units: Units, lastSets: readonly LastResultSet[], setIndexes?: readonly number[]): RowModel[] {
  const fields = fieldsFor(ex);
  const indexes = setIndexes ?? ex.sets.map((_, i) => i);
  return indexes.map((si) => {
    const set = ex.sets[si];
    const values = resolveSetValues(ex, set.id, lastSets);
    const working = ex.sets.slice(0, si + 1).filter((s) => s.setType === 'normal').length;
    const warmups = ex.sets.slice(0, si + 1).filter((s) => s.setType === 'warmup').length;
    // Only a drop can be "to failure" (the plan's rule), so F is always a drop: indented like D.
    const tagKind: RowTag =
      set.setType === 'warmup' ? 'warmup' : set.setType !== 'drop' ? 'normal' : set.target.toFailure ? 'failure' : 'drop';
    const tag = tagKind === 'warmup' ? 'W' : tagKind === 'drop' ? 'D' : tagKind === 'failure' ? 'F' : String(working);
    const name =
      tagKind === 'warmup' ? `Warm-up ${warmups}` : tagKind === 'normal' ? `Set ${working}` : tagKind === 'drop' ? 'Drop set' : 'Drop set to failure';
    return {
      setId: set.id,
      setIndex: si,
      tag,
      tagKind,
      name,
      done: set.completedAt !== null,
      cells: fields.map((f) => cellFor(f, set, values, units)),
      values,
    };
  });
}

/** "Rest 1:00": the coach's rest between this exercise's sets (its working sets' longest), or null. */
export function restLine(ex: LogExerciseDoc): string | null {
  const secs = Math.max(0, ...ex.sets.filter((s) => s.setType !== 'drop').map((s) => s.target.restSeconds ?? 0));
  return secs > 0 ? `Rest ${formatClock(secs)}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pages

export type ExerciseModel = {
  exerciseIndex: number;
  logExerciseId: string;
  exerciseId: string;
  name: string;
  /** "A1" in a superset, else null. */
  label: string | null;
  note: string | null;
  restLine: string | null;
  /** The coach's substitutes for this exercise (see substituteOf). */
  substitute: SubstituteModel | null;
  swappedFromExerciseId: string | null;
  lastTime: readonly LastResultSet[];
};

export type StraightPageModel = { kind: 'straight'; exercise: ExerciseModel; rows: RowModel[]; allDone: boolean };

export type RoundModel = {
  round: number;
  /** Each exercise with a set in this round (an uneven superset leaves the shorter one out of later rounds). */
  entries: Array<{ exerciseIndex: number; rows: RowModel[] }>;
  restLine: string | null;
  done: boolean;
};

export type SupersetPageModel = {
  kind: 'superset';
  /** "Superset 1 · Round 2 of 4". */
  heading: string;
  /** The first round with an unticked set (the last round when all are done). */
  currentRound: number;
  totalRounds: number;
  exercises: ExerciseModel[];
  rounds: RoundModel[];
  allDone: boolean;
};

export type OptionPageModel = {
  kind: 'option';
  /** "Option 2 of 3 · you’re doing this one". */
  line: string;
  /** This option is the pick. */
  picked: boolean;
  /** Another option is picked and has a ticked set, so this one can't be logged. */
  lockedOut: string | null;
  exercise: ExerciseModel;
  rows: RowModel[];
  allDone: boolean;
};

export type PageModel = StraightPageModel | SupersetPageModel | OptionPageModel;

function exerciseModel(ex: LogExerciseDoc, exerciseIndex: number, label: string | null, last: LastResults): ExerciseModel {
  return {
    exerciseIndex,
    logExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    name: ex.exerciseName,
    label,
    note: ex.note,
    restLine: restLine(ex),
    substitute: substituteOf(ex),
    swappedFromExerciseId: ex.swappedFromExerciseId,
    lastTime: last[ex.exerciseId]?.sets ?? [],
  };
}

/** Rounds of a superset: per exercise, round r is its r-th warm-up/working set with the drops that follow it. */
export function supersetRounds(block: LogBlockDoc): Array<{ round: number; entries: Array<{ exerciseIndex: number; setIndexes: number[] }> }> {
  const perExercise = liveExercises(block).map(({ exercise, exerciseIndex }) => {
    const indexOf = new Map<LogSetDoc, number>(exercise.sets.map((s, i) => [s, i]));
    return {
      exerciseIndex,
      groups: groupDropSets(exercise.sets).map((g) => [g.set, ...g.drops].map((s) => indexOf.get(s)!)),
    };
  });
  const total = blockRoundCount(block);
  return Array.from({ length: total }, (_, r) => ({
    round: r + 1,
    entries: perExercise.flatMap((e) => (e.groups[r] ? [{ exerciseIndex: e.exerciseIndex, setIndexes: e.groups[r] }] : [])),
  }));
}

export function buildPage(log: WorkoutLogDoc, page: FlowPage, units: Units, last: LastResults): PageModel {
  const block = log.blocks[page.blockIndex];
  const lastOf = (ex: LogExerciseDoc) => last[ex.exerciseId]?.sets ?? [];

  if (page.kind === 'superset') {
    const letter = supersetLetters(log.blocks)[page.blockIndex] ?? 'A';
    const exercises = block.exercises.map((ex, i) => exerciseModel(ex, i, `${letter}${i + 1}`, last));
    const rounds: RoundModel[] = supersetRounds(block).map(({ round, entries }) => {
      const rows = entries.map((e) => {
        const ex = block.exercises[e.exerciseIndex];
        return { exerciseIndex: e.exerciseIndex, rows: setRows(ex, units, lastOf(ex), e.setIndexes) };
      });
      const secs = roundRestSeconds(block, round);
      return {
        round,
        entries: rows,
        restLine: secs > 0 ? `Rest ${formatClock(secs)} after the round` : null,
        done: rows.every((e) => e.rows.every((r) => r.done)),
      };
    });
    const totalRounds = rounds.length;
    const currentRound = currentStep(block)?.round ?? Math.max(1, totalRounds);
    return {
      kind: 'superset',
      heading: `Superset ${page.number} · Round ${currentRound} of ${totalRounds}`,
      currentRound,
      totalRounds,
      exercises,
      rounds,
      allDone: isBlockDone(block),
    };
  }

  if (page.kind === 'option') {
    const ex = block.exercises[page.optionIndex];
    const picked = block.pickedExerciseId === ex.id;
    const other = block.exercises.find((e) => e.id === block.pickedExerciseId);
    const lockedOut = !picked && other && isChoiceLocked(block) ? `You’re doing ${other.exerciseName}. Swipe to it to log it.` : null;
    const where = `Option ${page.optionIndex + 1} of ${page.options}`;
    return {
      kind: 'option',
      line: picked ? `${where} · you’re doing this one` : lockedOut ? where : `${where} · log a set to pick it`,
      picked,
      lockedOut,
      exercise: exerciseModel(ex, page.optionIndex, null, last),
      rows: setRows(ex, units, lastOf(ex)),
      allDone: picked && isBlockDone(block),
    };
  }

  const ex = block.exercises[0];
  return { kind: 'straight', exercise: exerciseModel(ex, 0, null, last), rows: setRows(ex, units, lastOf(ex)), allDone: isBlockDone(block) };
}

/** Dots under the pages: done, current or to do. */
export function pageDots(log: WorkoutLogDoc, section: FlowSection, current: number): Array<'done' | 'current' | 'todo'> {
  return section.pages.map((p, i) => (i === current ? 'current' : isPageOpen(log, p) ? 'todo' : 'done'));
}

// ---------------------------------------------------------------------------------------------------------------
// Edits that touch several sets, or pick on the way

/**
 * The edit a ✓ (or a typed number) on a pick-one option makes first: picks that option when nothing is picked yet,
 * or switches to it while the current pick has no ticked set. The shared rule refuses once the pick is locked.
 */
export function pickingFirst(log: WorkoutLogDoc, blockId: string, logExerciseId: string, nowIso: string): WorkoutLogDoc {
  const block = log.blocks.find((b) => b.id === blockId);
  if (!block || block.kind !== 'choice' || block.pickedExerciseId === logExerciseId) return log;
  return pickChoice(log, blockId, logExerciseId, nowIso);
}

/**
 * "Mark all": ticks every open set of these exercises (in order), each with its pre-fill worked out from the doc as
 * it stands then, so a weight typed on set 1 carries into the sets after it.
 */
export function markAll(log: WorkoutLogDoc, logExerciseIds: readonly string[], last: LastResults, nowIso: string): WorkoutLogDoc {
  let next = log;
  for (const exId of logExerciseIds) {
    const setIds = next.blocks.flatMap((b) => b.exercises.filter((e) => e.id === exId).flatMap((e) => e.sets.map((s) => s.id)));
    for (const setId of setIds) {
      const ex = next.blocks.flatMap((b) => b.exercises).find((e) => e.id === exId);
      const set = ex?.sets.find((s) => s.id === setId);
      if (!ex || !set || set.completedAt !== null) continue;
      next = completeSetWith(next, setId, resolveSetValues(ex, setId, last[ex.exerciseId]?.sets ?? []), nowIso);
    }
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Finish

export type FinishModel = {
  done: number;
  total: number;
  /** "25 of 27 sets done." */
  headline: string;
  /** "2 sets of Tricep Pushdown aren’t ticked; they’ll be saved as not done." or null when all are ticked. */
  unticked: string | null;
  /** Nothing ticked: the workout can't be finished, only discarded. */
  noneDone: boolean;
};

export function finishModel(log: WorkoutLogDoc): FinishModel {
  const done = completedSetCount(log);
  const open = openSetCount(log);
  const total = done + open;
  const byExercise: Array<{ name: string; n: number }> = [];
  for (const b of log.blocks) {
    if (needsPick(b)) continue;
    for (const { exercise } of liveExercises(b)) {
      const n = exercise.sets.filter((s) => s.completedAt === null).length;
      if (n > 0) byExercise.push({ name: exercise.exerciseName, n });
    }
  }
  const unpicked = log.blocks.filter(needsPick).length;
  let unticked: string | null = null;
  if (open > 0) {
    const where =
      byExercise.length === 1 && unpicked === 0
        ? `${plural(byExercise[0].n, 'set')} of ${byExercise[0].name} ${byExercise[0].n === 1 ? "isn’t" : "aren’t"} ticked`
        : `${plural(open, 'set')} ${open === 1 ? "isn’t" : "aren’t"} ticked`;
    unticked = `${where}; ${open === 1 ? 'it’ll' : 'they’ll'} be saved as not done.`;
  }
  return { done, total, headline: `${done} of ${plural(total, 'set')} done.`, unticked, noneDone: done === 0 };
}

/**
 * "Changes from the plan" on the summary: exercises done instead of the planned one, and what was picked from each
 * pick-one group. `nameOf` gives an exercise's name by id (the log keeps only the planned exercise's id).
 */
export function planChanges(log: WorkoutLogDoc, nameOf: (exerciseId: string) => string | null): string[] {
  const out: string[] = [];
  const sections = new Map(log.sections.map((s) => [s.id, s.name]));
  for (const b of log.blocks) {
    if (b.kind === 'choice') {
      const picked = b.exercises.find((e) => e.id === b.pickedExerciseId);
      if (picked && picked.sets.some((s) => s.completedAt !== null)) {
        const where = b.sectionId ? sections.get(b.sectionId) : null;
        out.push(`${where ?? 'Pick one'}: picked ${picked.exerciseName}`);
      }
    }
    for (const { exercise: ex } of liveExercises(b)) {
      if (ex.swappedFromExerciseId === null) continue;
      const planned = substitutedFrom(ex)?.exerciseName ?? nameOf(ex.swappedFromExerciseId);
      out.push(planned ? `⇄ Did ${ex.exerciseName} instead of ${planned}` : `⇄ Did ${ex.exerciseName} instead of the planned exercise`);
    }
  }
  return out;
}

/** "Last time" rows for the history sheet: one line per set ("W · 20 lb × 10", "1 · 35 lb × 12"). */
export function historyLines(ex: Pick<LogExerciseDoc, 'trackingType'>, sets: readonly LastResultSet[], units: Units): string[] {
  let working = 0;
  return sets.map((s) => {
    const tag = s.setType === 'warmup' ? 'W' : s.setType === 'drop' ? 'D' : String((working += 1));
    const text = formatResult({ reps: s.actualReps, weightKg: s.actualWeightKg, durationS: s.actualDurationS, distanceM: s.actualDistanceM }, ex.trackingType, units);
    return `${tag} · ${text ?? '—'}`;
  });
}

/**
 * A number typed in a box (in the box's own unit: lb or kg, mi or km, seconds) as the stored patch, or null when
 * it can't be stored (over the log's limits). Blank clears the field.
 */
export function typedPatch(field: StepField, typed: number | null, units: Units): ActualPatch | null {
  switch (field) {
    case 'weight': {
      if (typed === null) return { actualWeightKg: null };
      const kg = toKg(typed, units);
      return kg <= 1000 ? { actualWeightKg: kg } : null;
    }
    case 'reps':
      return { actualReps: typed };
    case 'duration':
      return { actualDurationS: typed };
    case 'distance': {
      if (typed === null) return { actualDistanceM: null };
      const m = toMeters(typed, distanceUnitFor(units));
      return m <= 1_000_000 ? { actualDistanceM: m } : null;
    }
  }
}
