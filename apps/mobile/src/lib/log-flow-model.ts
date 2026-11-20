// What the logging screens show, worked out from the log. Pure (no React): the components only draw it.
//
// The workout is a list of SECTIONS (the coach's sections; a workout without sections is one unnamed section).
// Each section opens with a "Start section" page, then its PAGES, swiped left and right:
//   * a straight exercise is one page,
//   * a superset is one page (all its exercises, round by round),
//   * a pick-one group is one page per option (logging an option picks it).
// Every rule (pre-fill, pick-one, rounds, drops, counting) comes from @caltracker/shared; this file only lays it out.
import {
  targetFieldsFor,
  countsWeightTimesReps,
  exerciseBadges,
  setColumns,
  blockRoundCount,
  completeSetWith,
  completedSetCount,
  removeLogSet,
  addLogDrop,
  addLogSet,
  cursorStep,
  dropSetWeightKg,
  updateActual,
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
  formatWeight,
  kgToInput,
  loadStyleOf,
  liveExercises,
  needsPick,
  openSetCount,
  pickChoice,
  prefillLastTime,
  progressionHint,
  resolveSetValues,
  roundRestSeconds,
  sectionRuns,
  suggestionForLogExercise,
  toKg,
  toMeters,
  type ActualPatch,
  type LogBlockDoc,
  type LogExerciseDoc,
  type LogSetDoc,
  type ProgressionHistory,
  type SetValues,
  type StepField,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import type { Feeling } from '@caltracker/shared';
import { parseActualInput } from './active-log-logic';
import type { LastResultSet, LastResults } from './log-api';
import { orList, supersetLetters } from './workouts';

// ---------------------------------------------------------------------------------------------------------------
// Sections and pages

export type FlowPage =
  | { kind: 'straight'; key: string; blockIndex: number }
  | { kind: 'superset'; key: string; blockIndex: number; /** 1-based among the section's supersets. */ number: number }
  /** A pick-one group: one page, with a switch between its options (only the chosen one's sets show). */
  | { kind: 'option'; key: string; blockIndex: number; options: number };

export type FlowSection = {
  key: string;
  /** The coach's section name; null for a workout without sections (or exercises added after the last section). */
  name: string | null;
  /** What the header and the start page call it: the section name, else the workout's name. */
  title: string;
  blockIndexes: number[];
  pages: FlowPage[];
  /** "1 exercise", "3 supersets · 6 exercises", "Pick one of 3". */
  countLine: string;
  /** Every page done (a pick-one group counts once it is picked and its sets are ticked). */
  done: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countLine(blocks: readonly LogBlockDoc[]): string {
  if (blocks.length === 1 && blocks[0].kind === 'choice') {
    return `Pick one of ${blocks[0].exercises.length}`;
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
      pages.push({ kind: 'option', key: block.id, blockIndex: bi, options: block.exercises.length });
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
  return needsPick(block) || !isBlockDone(block);
}

/** Where the workout picks up: the first open page, else null. */
export function resumePlace(log: WorkoutLogDoc, sections: readonly FlowSection[]): FlowPlace | null {
  for (let s = 0; s < sections.length; s += 1) {
    const pages = sections[s].pages;
    for (let p = 0; p < pages.length; p += 1) {
      if (isPageOpen(log, pages[p])) return { section: s, page: p };
    }
  }
  return null;
}

/** The first page of the workout (the first section with pages), or null for an empty workout. */
export function firstPlace(sections: readonly FlowSection[]): FlowPlace | null {
  const s = sections.findIndex((x) => x.pages.length > 0);
  return s >= 0 ? { section: s, page: 0 } : null;
}

/** Where Start (or Continue) lands: straight on the first open set's page, else the first page. */
export function startPlace(log: WorkoutLogDoc, sections: readonly FlowSection[]): FlowPlace | null {
  return resumePlace(log, sections) ?? firstPlace(sections);
}

/**
 * What a page is called in "Next: …" and on Today: the exercise; in a superset the exercise of its next set with its
 * A1 label; a pick-one group's pick, else its options ("Bike sprints or Sled push").
 */
export function pageLabel(log: WorkoutLogDoc, page: FlowPage): string {
  const block = log.blocks[page.blockIndex];
  if (!block) return '';
  if (page.kind === 'superset') {
    const i = cursorStep(block)?.exerciseIndex ?? 0;
    const letter = supersetLetters(log.blocks)[page.blockIndex] ?? 'A';
    return `${letter}${i + 1} ${block.exercises[i]?.exerciseName ?? ''}`.trim();
  }
  if (page.kind === 'option') {
    const picked = block.exercises.find((e) => e.id === block.pickedExerciseId);
    return picked ? picked.exerciseName : orList(block.exercises.map((e) => e.exerciseName));
  }
  return block.exercises[0]?.exerciseName ?? '';
}

/**
 * What comes next in a workout in progress, for Today's "6 of 19 sets · next: A1 Romanian Deadlift": the first open
 * page, or null when all is ticked.
 */
export function nextUpLabel(log: WorkoutLogDoc): string | null {
  const sections = buildSections(log);
  const at = resumePlace(log, sections);
  const page = at ? sections[at.section]?.pages[at.page] : undefined;
  return page ? pageLabel(log, page) || null : null;
}

/** The bottom button: "Next: Leg Extension", or Finish workout on the last page. */
export function nextAction(log: WorkoutLogDoc, sections: readonly FlowSection[], at: FlowPlace): { kind: 'next'; label: string; to: FlowPlace } | { kind: 'finish' } {
  const next = afterDone(sections, at);
  if (next.kind === 'finish') return { kind: 'finish' };
  const to = next.kind === 'page' ? { section: at.section, page: next.page } : { section: next.section, page: 0 };
  const page = sections[to.section]?.pages[to.page];
  return { kind: 'next', label: page ? `Next: ${pageLabel(log, page)}` : 'Next', to };
}

/** Unticked sets on a page (of the option shown on a pick-one page), for "2 sets not ticked". */
export function openSetsOnPage(log: WorkoutLogDoc, page: FlowPage): { count: number; logExerciseIds: string[] } {
  const block = log.blocks[page.blockIndex];
  if (!block) return { count: 0, logExerciseIds: [] };
  const exercises =
    page.kind === 'option' ? [block.exercises.find((e) => e.id === block.pickedExerciseId) ?? block.exercises[0]].filter((e): e is LogExerciseDoc => !!e) : block.exercises;
  return {
    count: exercises.reduce((n, e) => n + e.sets.filter((x) => x.completedAt === null).length, 0),
    logExerciseIds: exercises.map((e) => e.id),
  };
}

/** "2 sets not ticked". */
export function notTickedTitle(n: number): string {
  return `${plural(n, 'set')} not ticked`;
}

/**
 * The logger's header: "Lower Body · Main" over "Exercise 1 of 5 ▾" (a superset: "Superset A · Round 2 of 3 ▾", the
 * round of the set after the last tick; a pick-one group: "Pick one · 5 of 5 ▾"). Pages are counted across the whole
 * workout. The ▾ opens the list of every exercise.
 */
export function headerLines(log: WorkoutLogDoc, sections: readonly FlowSection[], at: FlowPlace): { title: string; subtitle: string } {
  const section = sections[at.section];
  const title = section?.name ? `${log.name} · ${section.name}` : log.name;
  const all = sections.flatMap((s) => s.pages);
  const before = sections.slice(0, at.section).reduce((n, s) => n + s.pages.length, 0);
  const n = before + at.page + 1;
  const page = section?.pages[at.page];
  const block = page ? log.blocks[page.blockIndex] : undefined;
  if (page?.kind === 'superset' && block) {
    const letter = supersetLetters(log.blocks)[page.blockIndex] ?? 'A';
    const total = blockRoundCount(block);
    const round = Math.min(total, cursorStep(block)?.round ?? total);
    return { title, subtitle: `Superset ${letter} · Round ${Math.max(1, round)} of ${Math.max(1, total)} ▾` };
  }
  if (page?.kind === 'option') return { title, subtitle: `Pick one · ${n} of ${all.length} ▾` };
  return { title, subtitle: `Exercise ${n} of ${all.length} ▾` };
}

/** "" (under a minute), "12 min in", "1 h 5 min in". */
export function elapsedLabel(startedAt: string, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 60_000));
  // Nothing under a minute (approved LT1 board): the header stays quiet until there is time to show.
  if (Number.isNaN(min) || min < 1) return '';
  if (min < 60) return `${min} min in`;
  return `${Math.floor(min / 60)} h ${min % 60} min in`;
}

export type AfterDone = { kind: 'page'; page: number } | { kind: 'section'; section: number } | { kind: 'finish' };

/**
 * Where Next goes: the next page of the section; after the section's last page, the next section's first page (an
 * empty section is skipped); after the last page, the finish sheet.
 */
export function afterDone(sections: readonly FlowSection[], at: FlowPlace): AfterDone {
  const pages = sections[at.section]?.pages ?? [];
  const next = at.page + 1;
  if (next < pages.length) return { kind: 'page', page: next };
  for (let s = at.section + 1; s < sections.length; s += 1) if (sections[s].pages.length > 0) return { kind: 'section', section: s };
  return { kind: 'finish' };
}

/**
 * One page back (-1) or forward (+1), crossing into the previous or next section, without logging anything. Null at
 * either end of the workout.
 */
export function stepPlace(sections: readonly FlowSection[], at: FlowPlace, delta: -1 | 1): FlowPlace | null {
  const page = at.page + delta;
  if (page >= 0 && page < (sections[at.section]?.pages.length ?? 0)) return { section: at.section, page };
  for (let s = at.section + delta; s >= 0 && s < sections.length; s += delta) {
    const n = sections[s].pages.length;
    if (n > 0) return { section: s, page: delta < 0 ? n - 1 : 0 };
  }
  return null;
}

/** What the ‹ and › buttons (and the swipe past a section's edge) say: "Next page", "Previous section: Warm-Up". */
export function stepLabel(sections: readonly FlowSection[], at: FlowPlace, delta: -1 | 1): string | null {
  const to = stepPlace(sections, at, delta);
  if (!to) return null;
  const dir = delta < 0 ? 'Previous' : 'Next';
  return to.section === at.section ? `${dir} page` : `${dir} section: ${sections[to.section].title}`;
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
  /** The coach's note on the substitute, when the plan carries one. */
  note: string | null;
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
      note: option.note !== null && option.note.trim() !== '' ? option.note : null,
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
  /** Column heading on a straight page ("LB", "REPS", "TIME", "MI"; "LB EACH", "REPS EACH" for an each-side exercise). */
  heading: string;
  /** The unit as words under a superset's cell ("lb", "reps", "m:ss", "mi"; "lb each", "reps each" for each side). */
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
  /** "1", "W", "↓ Drop" or "F" (to failure): the first column. */
  tag: string;
  tagKind: RowTag;
  /** A drop (to failure or not) sits indented under the set above. */
  indented: boolean;
  /** "Set 2", "Warm-up 1", "Drop set": for screen readers. */
  name: string;
  done: boolean;
  cells: CellModel[];
  /** What ✓ saves into the actuals still empty. */
  values: SetValues;
  /** The shared rule allows removing it (not the only set of the exercise). */
  deletable: boolean;
  /** Last time's numbers for this set ("57.5 × 8"), matched by kind and order; null when there are none. */
  last: string | null;
  /** The next set to do on a superset page: the set after the last tick (ticking A1 moves this to A2). */
  current: boolean;
  /** Its set menu offers "Add drop set": an exercise with weight, and not a warm-up. */
  canDrop: boolean;
};

const FIELD_ORDER: readonly StepField[] = ['weight', 'reps', 'duration', 'distance'];

function cellFor(field: StepField, set: LogSetDoc, values: SetValues, units: Units, eachSide: boolean): CellModel {
  const each = eachSide ? ' each' : '';
  switch (field) {
    case 'weight': {
      const show = (v: number | null) => (v === null ? '' : String(kgToInput(v, units)));
      return { field, heading: units.toUpperCase(), unit: `${units}${each}`, value: show(set.actualWeightKg), placeholder: show(values.weightKg) };
    }
    case 'reps': {
      const show = (v: number | null) => (v === null ? '' : String(v));
      return { field, heading: 'REPS', unit: `reps${each}`, value: show(set.actualReps), placeholder: show(values.reps) };
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

/** The fields a tracking type logs, weight first ("135 × 8"). A type this build doesn't know logs as the fallback (reps). */
export function fieldsFor(ex: Pick<LogExerciseDoc, 'trackingType'>): StepField[] {
  const keep = targetFieldsFor(ex.trackingType) as readonly string[];
  return FIELD_ORDER.filter((f) => keep.includes(f));
}

const DELETABLE_AT = '1970-01-01T00:00:00.000Z';

/**
 * The sets the shared removeLogSet would remove, asked once per exercise on a doc holding only that exercise
 * (cheap, and the rule stays in @caltracker/shared).
 */
function deletableSets(ex: LogExerciseDoc): Set<string> {
  const mini: WorkoutLogDoc = {
    id: ex.id,
    workoutId: null,
    name: 'x',
    status: 'in_progress',
    startedAt: DELETABLE_AT,
    finishedAt: null,
    lastActivityAt: DELETABLE_AT,
    autoFinished: false,
    revision: 0,
    notes: null,
    sections: [],
    blocks: [{ id: ex.id, sectionId: null, pickedExerciseId: null, kind: 'straight', exercises: [ex] }],
  };
  return new Set(ex.sets.filter((s) => removeLogSet(mini, ex.id, s.id, DELETABLE_AT) !== mini).map((s) => s.id));
}

/** Last time's set for each of these sets, matched by kind and order (2nd warm-up to 2nd warm-up, 1st drop to 1st drop). */
function lastFor(sets: readonly LogSetDoc[], lastSets: readonly LastResultSet[]): Array<LastResultSet | null> {
  const seen: Record<string, number> = {};
  return sets.map((set) => {
    const n = (seen[set.setType] = (seen[set.setType] ?? 0) + 1);
    return lastSets.filter((l) => l.setType === set.setType)[n - 1] ?? null;
  });
}

/** "57.5 × 8", "12", "0:45": last time's set without units (the column heading says them). */
export function lastCellText(l: LastResultSet | null, trackingType: LogExerciseDoc['trackingType'], units: Units): string | null {
  if (!l) return null;
  const text = formatResult({ reps: l.actualReps, weightKg: l.actualWeightKg, durationS: l.actualDurationS, distanceM: l.actualDistanceM }, trackingType, units);
  return text ? text.replace(/ (kg|lb)\b/g, '').replace(/ reps?\b/g, '') : null;
}

/** Weight on a bodyweight exercise (pull-ups, dips) is weight added to the body, and optional. */
const isBodyweight = (ex: Pick<LogExerciseDoc, 'exerciseName'>) => loadStyleOf(ex.exerciseName) === 'added';

/**
 * One row per set of the exercise, or only the sets at `setIndexes` (a superset round). `lastSets` is what the pre-fill
 * reads (last time, with Auto progression's suggestion); `lastTime` is last time's own numbers, for the Last time
 * column (defaults to `lastSets`).
 */
export function setRows(
  ex: LogExerciseDoc,
  units: Units,
  lastSets: readonly LastResultSet[],
  setIndexes?: readonly number[],
  lastTime: readonly LastResultSet[] = lastSets,
): RowModel[] {
  const fields = fieldsFor(ex);
  const eachSide = ex.eachSide === true;
  // The headings are the shared set columns' ("LB EACH | REPS EACH | TIME"), one per field logged.
  const headings = new Map(setColumns(ex.trackingType, units, { eachSide }).map((c) => [c.field, c.heading]));
  const indexes = setIndexes ?? ex.sets.map((_, i) => i);
  const lastBySet = lastFor(ex.sets, lastTime);
  const bodyweight = isBodyweight(ex);
  return indexes.map((si) => {
    const set = ex.sets[si];
    const values = resolveSetValues(ex, set.id, lastSets);
    const working = ex.sets.slice(0, si + 1).filter((s) => s.setType === 'normal').length;
    const warmups = ex.sets.slice(0, si + 1).filter((s) => s.setType === 'warmup').length;
    // A drop (to failure or not) reads "↓ Drop" and sits indented; F is a normal set to failure (the builder's F).
    const isDrop = set.setType === 'drop';
    const tagKind: RowTag = set.setType === 'warmup' ? 'warmup' : isDrop ? 'drop' : set.target.toFailure ? 'failure' : 'normal';
    const tag = tagKind === 'warmup' ? 'W' : tagKind === 'drop' ? '↓ Drop' : tagKind === 'failure' ? 'F' : String(working);
    const name =
      tagKind === 'warmup'
        ? `Warm-up ${warmups}`
        : tagKind === 'normal'
          ? `Set ${working}`
          : tagKind === 'drop'
            ? set.target.toFailure
              ? 'Drop set to failure'
              : 'Drop set'
            : `Set ${working} to failure`;
    return {
      setId: set.id,
      setIndex: si,
      tag,
      tagKind,
      indented: isDrop,
      name,
      done: set.completedAt !== null,
      // A ticked set shows only what was saved: never the greyed pre-fill.
      cells: fields.map((f) => {
        const base = cellFor(f, set, values, units, eachSide);
        let cell = { ...base, heading: headings.get(f) ?? base.heading };
        // Nothing to suggest: say what goes in the box ("max" reps on a drop to failure, "+ kg" added weight, which is
        // optional). Short, so they fit a phone's box; the screen reader hears it in full (set-table.tsx).
        if (cell.placeholder === '' && f === 'reps' && isDrop && set.target.toFailure) cell = { ...cell, placeholder: 'max' };
        if (cell.placeholder === '' && f === 'weight' && bodyweight) cell = { ...cell, placeholder: `+ ${units}` };
        return set.completedAt === null ? cell : { ...cell, placeholder: '' };
      }),
      values,
      deletable: deletableSets(ex).has(set.id),
      last: lastCellText(lastBySet[si] ?? null, ex.trackingType, units),
      current: false,
      canDrop: dropPlan(ex, set.id, units, lastSets) !== null,
    };
  });
}

/**
 * The sets the "Delete a set" sheet offers for an exercise: every set the shared rule lets go (not the only one),
 * named with its numbers so two drop sets can be told apart ("Set 2 · 135 lb × 8").
 */
export function deleteChoices(ex: LogExerciseDoc, units: Units, lastSets: readonly LastResultSet[]): Array<{ setId: string; title: string }> {
  return setRows(ex, units, lastSets)
    .filter((r) => r.deletable)
    .map((r) => {
      const parts = r.cells.flatMap((c) => {
        // Only a number: a word hint ("max", "+ kg") is not a value.
        const v = c.value || (/^[\d.,:]+$/.test(c.placeholder) ? c.placeholder : '');
        if (!v) return [];
        return [c.field === 'duration' ? v : `${v} ${c.unit}`];
      });
      return { setId: r.setId, title: parts.length > 0 ? `${r.name} · ${parts.join(' × ')}` : r.name };
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
  /** "Last: 55 lb × 10" (last time's first working set), or null without one (no "First time": approved SS board). */
  lastLine: string | null;
  /** Auto progression's suggestion, "Suggested 140 lb · ↑ +5 lb", or null. */
  progression: string | null;
  /** The coach's "Each side" and "Tempo 3-1-1-0" badges under the name (shared exerciseBadges), and their help line. */
  badges: string[];
  badgeHelp: string | null;
};

/** Auto progression for the pre-fill: the client's recent sessions (empty when off) and their units. */
export type Progression = { history: ProgressionHistory; units: Units };

/** Last time as the pre-fill reads it for this exercise: with Auto progression's suggested weight, if any. */
export function prefillSets(ex: LogExerciseDoc, last: LastResults, progression?: Progression): readonly LastResultSet[] {
  const sets = last[ex.exerciseId]?.sets ?? [];
  return progression ? prefillLastTime(ex, sets, progression.history, progression.units) : sets;
}

/**
 * "Suggested 140 lb · ↑ +5 lb" for an exercise Auto progression moves, else null. Only while the first working set
 * actually shows that weight: a set ticked before the history loaded (offline, slow signal) carries its own weight
 * forward, and then the line would name a number the boxes don't use.
 */
export function progressionLine(ex: LogExerciseDoc, last: LastResults, progression?: Progression): string | null {
  if (!progression) return null;
  const s = suggestionForLogExercise(ex, progression.history, progression.units);
  const first = ex.sets.find((x) => x.setType === 'normal');
  if (!s || !first) return null;
  if (resolveSetValues(ex, first.id, prefillSets(ex, last, progression)).weightKg !== s.weightKg) return null;
  return `Suggested ${formatWeight(s.weightKg, progression.units)} · ${progressionHint(s, progression.units)}`;
}

export type StraightPageModel = { kind: 'straight'; exercise: ExerciseModel; rows: RowModel[]; allDone: boolean };

/**
 * How a round shows (approved Superset boards SS1–SS5):
 * - done: folded into one line (✓ Round 1 · 45 × 12 · 15 × 12), tap to open;
 * - partial: not the current round but with a set still open ("Round 2 · 1 left"), open until folded;
 * - current: the card "Round 3 of 4" holding the set after the last tick;
 * - future: after the current round with nothing ticked; its heading and suggested numbers are faded.
 */
export type RoundKind = 'done' | 'partial' | 'current' | 'future';

export type RoundModel = {
  round: number;
  kind: RoundKind;
  /** "Round 3 of 4": the current and future rounds' heading. */
  heading: string;
  /** "Round 2": the fold line of a done or partial round. */
  title: string;
  /** The fold line's summary: "60 × 6 +↓ 45 × 8 · 20 × 12" (done) or "1 left" (partial). */
  summary: string;
  /** Each exercise with a set in this round (an uneven superset leaves the shorter one out of later rounds). */
  entries: Array<{ exerciseIndex: number; rows: RowModel[] }>;
  /** "Rest 1:30", only when the rounds rest differently (else the page's intro says it once). */
  restLine: string | null;
  done: boolean;
};

export type SupersetPageModel = {
  kind: 'superset';
  blockId: string;
  /** "Superset A": the page's title. */
  heading: string;
  /** "Back to back, then rest 1:30" (one rest for every round), else "Back to back". */
  intro: string;
  /** The round of the set after the last tick (the last round when all are done). */
  currentRound: number;
  totalRounds: number;
  exercises: ExerciseModel[];
  /** The badges' explanation ("Each side: …"), under the first exercise that needs it, once per page. */
  helpAfter: Record<number, string>;
  rounds: RoundModel[];
  allDone: boolean;
};

/** A done set in short: "45 × 12", "12", "0:45" (the units are on the exercise rows). */
function setShort(set: LogSetDoc, trackingType: LogExerciseDoc['trackingType'], units: Units): string {
  return lastCellText({ setType: set.setType, actualReps: set.actualReps, actualWeightKg: set.actualWeightKg, actualDurationS: set.actualDurationS, actualDistanceM: set.actualDistanceM }, trackingType, units) ?? '–';
}

/**
 * A folded round's line: each exercise's set in round order, a drop added as "+↓" ("60 × 6 +↓ 45 × 8 · 20 × 12").
 * The screen cuts a long one short with "…".
 */
export function roundSummary(block: LogBlockDoc, entries: ReadonlyArray<{ exerciseIndex: number; setIndexes: readonly number[] }>, units: Units): string {
  return entries
    .map((e) => {
      const ex = block.exercises[e.exerciseIndex];
      return e.setIndexes
        .map((si) => {
          const set = ex.sets[si];
          const short = setShort(set, ex.trackingType, units);
          return set.setType === 'drop' ? ` +↓ ${short}` : short;
        })
        .join('');
    })
    .join(' · ');
}

/** Which rounds are opened or folded by hand (a round's number to open or not); the rest follow their kind. */
export type FoldState = Readonly<Record<number, boolean>>;

/** Shown open: the current and future rounds always; a partly done one until folded; a done one once opened. */
export function isRoundOpen(fold: FoldState, round: Pick<RoundModel, 'round' | 'kind'>): boolean {
  if (round.kind === 'current' || round.kind === 'future') return true;
  return fold[round.round] ?? round.kind === 'partial';
}

/** Tapping a round's line: open it, or fold it again. Opening an old round never moves the header. */
export function toggleRound(fold: FoldState, round: Pick<RoundModel, 'round' | 'kind'>): FoldState {
  return { ...fold, [round.round]: !isRoundOpen(fold, round) };
}

export type OptionChoice = { logExerciseId: string; name: string; chosen: boolean };

export type OptionPageModel = {
  kind: 'option';
  blockId: string;
  /** The switch: every option, the one shown chosen. */
  choices: OptionChoice[];
  /** Something is picked (else the first option shows, and ticking it picks it). */
  picked: boolean;
  /** A set of the chosen option is ticked: the switch can no longer change. */
  locked: boolean;
  /** The option shown (the pick, else the first). */
  exercise: ExerciseModel;
  rows: RowModel[];
  allDone: boolean;
};

export type PageModel = StraightPageModel | SupersetPageModel | OptionPageModel;

/** The badges and help line the client sees under an exercise's name. */
export function badgesOf(ex: Pick<LogExerciseDoc, 'trackingType' | 'eachSide' | 'tempo'>): { badges: string[]; badgeHelp: string | null } {
  const { badges, help } = exerciseBadges(ex);
  return { badges, badgeHelp: help };
}

function lastLineOf(ex: LogExerciseDoc, sets: readonly LastResultSet[], units: Units): string | null {
  const l = sets.find((x) => x.setType === 'normal') ?? sets[0] ?? null;
  if (!l) return null;
  const text = formatResult({ reps: l.actualReps, weightKg: l.actualWeightKg, durationS: l.actualDurationS, distanceM: l.actualDistanceM }, ex.trackingType, units);
  return text ? `Last: ${text}` : null;
}

function exerciseModel(
  ex: LogExerciseDoc,
  exerciseIndex: number,
  label: string | null,
  last: LastResults,
  progression: Progression | undefined,
  units: Units,
): ExerciseModel {
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
    lastLine: lastLineOf(ex, last[ex.exerciseId]?.sets ?? [], units),
    progression: progressionLine(ex, last, progression),
    ...badgesOf(ex),
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

export function buildPage(log: WorkoutLogDoc, page: FlowPage, units: Units, last: LastResults, history?: ProgressionHistory): PageModel {
  const block = log.blocks[page.blockIndex];
  const progression: Progression | undefined = history ? { history, units } : undefined;
  const lastOf = (ex: LogExerciseDoc) => prefillSets(ex, last, progression);
  const lastTimeOf = (ex: LogExerciseDoc) => last[ex.exerciseId]?.sets ?? [];

  if (page.kind === 'superset') {
    const letter = supersetLetters(log.blocks)[page.blockIndex] ?? 'A';
    const exercises = block.exercises.map((ex, i) => exerciseModel(ex, i, `${letter}${i + 1}`, last, progression, units));
    const plan = supersetRounds(block);
    const roundCount = plan.length;
    const cursor = cursorStep(block);
    const currentRound = cursor?.round ?? Math.max(1, roundCount);
    const rests = plan.map(({ round }) => roundRestSeconds(block, round));
    const oneRest = rests.every((r) => r === rests[0]);
    const rounds: RoundModel[] = plan.map(({ round, entries }, k) => {
      const rows = entries.map((e) => {
        const ex = block.exercises[e.exerciseIndex];
        return { exerciseIndex: e.exerciseIndex, rows: setRows(ex, units, lastOf(ex), e.setIndexes, lastTimeOf(ex)) };
      });
      const all = rows.flatMap((e) => e.rows);
      const done = all.every((r) => r.done);
      const left = all.filter((r) => !r.done).length;
      const kind: RoundKind =
        round === currentRound ? 'current' : done ? 'done' : round > currentRound && left === all.length ? 'future' : 'partial';
      return {
        round,
        kind,
        heading: `Round ${round} of ${roundCount}`,
        title: `Round ${round}`,
        summary: kind === 'done' ? roundSummary(block, entries, units) : `${left} left`,
        entries: rows,
        restLine: !oneRest && rests[k] > 0 ? `Rest ${formatClock(rests[k])}` : null,
        done,
      };
    });
    // The set after the last tick is outlined, so the client's eye moves with the round (A1, A2, next round).
    for (const r of rounds) for (const e of r.entries) for (const row of e.rows) row.current = cursor !== null && row.setId === cursor.setId;
    const helpAfter: Record<number, string> = {};
    const said = new Set<string>();
    for (const ex of exercises) {
      if (ex.badgeHelp && !said.has(ex.badgeHelp)) {
        said.add(ex.badgeHelp);
        helpAfter[ex.exerciseIndex] = ex.badgeHelp;
      }
    }
    return {
      kind: 'superset',
      blockId: block.id,
      heading: `Superset ${letter}`,
      intro: oneRest && rests[0] > 0 ? `Back to back, then rest ${formatClock(rests[0])}` : 'Back to back',
      currentRound,
      totalRounds: rounds.length,
      exercises,
      helpAfter,
      rounds,
      allDone: isBlockDone(block),
    };
  }

  if (page.kind === 'option') {
    const shownIndex = Math.max(0, block.exercises.findIndex((e) => e.id === block.pickedExerciseId));
    const ex = block.exercises[shownIndex];
    return {
      kind: 'option',
      blockId: block.id,
      choices: block.exercises.map((e, i) => ({ logExerciseId: e.id, name: e.exerciseName, chosen: i === shownIndex })),
      picked: block.pickedExerciseId !== null,
      locked: isChoiceLocked(block),
      exercise: exerciseModel(ex, shownIndex, null, last, progression, units),
      rows: setRows(ex, units, lastOf(ex), undefined, lastTimeOf(ex)),
      allDone: block.pickedExerciseId !== null && isBlockDone(block),
    };
  }

  const ex = block.exercises[0];
  return {
    kind: 'straight',
    exercise: exerciseModel(ex, 0, null, last, progression, units),
    rows: setRows(ex, units, lastOf(ex), undefined, lastTimeOf(ex)),
    allDone: isBlockDone(block),
  };
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
 * "+ Add round" on a superset (approved SS5 board): every exercise is topped up to the longest one, then each gets one
 * more set. New sets copy the exercise's last set (shared addLogSet), so they suggest its numbers in grey.
 */
export function addRound(log: WorkoutLogDoc, blockId: string, makeId: () => string, nowIso: string): WorkoutLogDoc {
  const block = log.blocks.find((b) => b.id === blockId);
  if (!block) return log;
  const live = liveExercises(block);
  const counts = live.map(({ exercise }) => groupDropSets(exercise.sets).length);
  const longest = Math.max(0, ...counts);
  let next = log;
  live.forEach(({ exercise }, i) => {
    for (let k = counts[i]; k < longest + 1; k += 1) next = addLogSet(next, exercise.id, makeId, nowIso);
  });
  return next;
}

/**
 * Where a drop for this set would go and the weight it starts at: after the set's own drops, at 75% of the set above
 * it (done, else as planned), rounded down to the plate step (shared dropSetWeightKg). Null when it can have none: no
 * weight logged, a warm-up, or too light to drop (75% under one step). An unknown weight still allows one, empty.
 */
export function dropPlan(
  ex: LogExerciseDoc,
  setId: string,
  units: Units,
  lastSets: readonly LastResultSet[],
): { parentId: string; weightKg: number | null } | null {
  if (!fieldsFor(ex).includes('weight')) return null;
  let parentAt = ex.sets.findIndex((s) => s.id === setId);
  while (parentAt > 0 && ex.sets[parentAt].setType === 'drop') parentAt -= 1;
  const parent = ex.sets[parentAt];
  if (!parent || parent.setType !== 'normal') return null;
  let aboveAt = parentAt;
  while (ex.sets[aboveAt + 1]?.setType === 'drop') aboveAt += 1;
  const above = ex.sets[aboveAt];
  const baseKg = above.actualWeightKg ?? resolveSetValues(ex, above.id, lastSets).weightKg;
  if (baseKg === null || baseKg <= 0) return { parentId: parent.id, weightKg: null };
  const weightKg = dropSetWeightKg(baseKg, units);
  return weightKg === null ? null : { parentId: parent.id, weightKg };
}

/**
 * The set the exercise ··· menu's "Add drop set" follows: the last ticked working set, else the set the outline is
 * on (cursorStep) when it is this exercise's, else the exercise's last working set.
 */
export function exerciseDropSetId(block: LogBlockDoc, ex: LogExerciseDoc): string | null {
  const ticked = ex.sets
    .filter((s) => s.setType === 'normal' && s.completedAt !== null)
    .reduce<LogSetDoc | null>((a, s) => (a === null || Date.parse(s.completedAt!) >= Date.parse(a.completedAt!) ? s : a), null);
  if (ticked) return ticked.id;
  const cursor = cursorStep(block);
  if (cursor && block.exercises[cursor.exerciseIndex]?.id === ex.id) return cursor.setId;
  return [...ex.sets].reverse().find((s) => s.setType === 'normal')?.id ?? null;
}

/**
 * "Add drop set": a ↓ Drop row after the set (after its drops, if any), its weight started as dropPlan says. `dropId`
 * is the new set's id, so the screen can put the cursor in its reps. Nothing changes when the set can't have a drop.
 */
export function addDropSet(
  log: WorkoutLogDoc,
  logExerciseId: string,
  setId: string,
  dropId: string,
  units: Units,
  lastSets: readonly LastResultSet[],
  nowIso: string,
): WorkoutLogDoc {
  const ex = log.blocks.flatMap((b) => b.exercises).find((e) => e.id === logExerciseId);
  const plan = ex ? dropPlan(ex, setId, units, lastSets) : null;
  if (!plan) return log;
  const added = addLogDrop(log, logExerciseId, plan.parentId, () => dropId, nowIso);
  if (added === log) return log;
  return plan.weightKg === null ? added : updateActual(added, dropId, { actualWeightKg: plan.weightKg });
}

export type MenuKey = 'note' | 'history' | 'info' | 'add-set' | 'add-drop' | 'delete-set' | 'remove';

/**
 * An exercise's ··· menu, in order (approved SS5 board): Note for Demo, Last time, How to do it, Add set, Add drop
 * set, Delete set, Remove exercise. Last time only with a last time; Add drop set only when its set can have one
 * (dropPlan); Delete set only when a set may go.
 */
export function exerciseMenu(
  ex: LogExerciseDoc,
  o: { coachName: string | null; hasLastTime: boolean; deletable: boolean; canDrop: boolean },
): Array<{ key: MenuKey; title: string; destructive?: boolean }> {
  return [
    { key: 'note' as const, title: `Note for ${o.coachName ?? 'your coach'}` },
    ...(o.hasLastTime ? [{ key: 'history' as const, title: 'Last time' }] : []),
    { key: 'info' as const, title: 'How to do it' },
    { key: 'add-set' as const, title: 'Add set' },
    ...(o.canDrop ? [{ key: 'add-drop' as const, title: 'Add drop set' }] : []),
    ...(o.deletable ? [{ key: 'delete-set' as const, title: 'Delete set', destructive: true }] : []),
    { key: 'remove' as const, title: 'Remove exercise', destructive: true },
  ];
}

/** A set row's menu (its ··· or a long press): Add drop set above Delete set (approved SS3 board). */
export function setMenu(row: Pick<RowModel, 'canDrop' | 'deletable'>): Array<{ key: 'add-drop' | 'delete-set'; title: string; destructive?: boolean }> {
  return [
    ...(row.canDrop ? [{ key: 'add-drop' as const, title: 'Add drop set' }] : []),
    ...(row.deletable ? [{ key: 'delete-set' as const, title: 'Delete set', destructive: true }] : []),
  ];
}

const isEmpty = (v: SetValues) => v.reps === null && v.weightKg === null && v.durationS === null && v.distanceM === null;

export type MarkAllPlan = {
  /** Open sets it ticks. */
  tick: number;
  /** Open sets it leaves: no numbers to save yet (nothing typed, no coach target, no last time). */
  skip: number;
  /**
   * Of the sets it ticks, weight-and-reps ones (shared countsWeightTimesReps) that get no weight (reps only: could be
   * bodyweight, so allowed).
   */
  noWeight: number;
};

/** What "Mark all" would do, for its question (markAllQuestion). Auto progression's suggestion counts as a number. */
export function markAllPlan(
  log: WorkoutLogDoc,
  logExerciseIds: readonly string[],
  last: LastResults,
  progression?: Progression,
): MarkAllPlan {
  const done = markAll(log, logExerciseIds, last, DELETABLE_AT, progression);
  const exercises = (l: WorkoutLogDoc) => l.blocks.flatMap((b) => b.exercises.filter((e) => logExerciseIds.includes(e.id)));
  const open = (l: WorkoutLogDoc) => exercises(l).flatMap((e) => e.sets).filter((x) => x.completedAt === null).length;
  const wasOpen = new Set(exercises(log).flatMap((e) => e.sets.filter((x) => x.completedAt === null).map((x) => x.id)));
  const noWeight = exercises(done)
    .filter((e) => countsWeightTimesReps(e.trackingType))
    .flatMap((e) => e.sets)
    .filter((x) => wasOpen.has(x.id) && x.completedAt !== null && x.actualWeightKg === null).length;
  const tick = open(log) - open(done);
  return { tick, skip: open(done), noWeight };
}

/** "Tick 4 sets with these numbers?" and, when some get no weight or are left, says so. */
export function markAllQuestion(plan: MarkAllPlan): { title: string; message: string | null } {
  const title = `Tick ${plural(plan.tick, 'set')} with these numbers?`;
  const lines: string[] = [];
  if (plan.noWeight > 0) lines.push(`${plural(plan.noWeight, 'set')} ${plan.noWeight === 1 ? 'has' : 'have'} no weight.`);
  if (plan.skip > 0) {
    lines.push(`${plural(plan.skip, 'set')} ${plan.skip === 1 ? 'has' : 'have'} no numbers yet, so ${plan.skip === 1 ? 'it stays' : 'they stay'} unticked.`);
  }
  return { title, message: lines.length > 0 ? lines.join(' ') : null };
}

/**
 * "Mark all": ticks every open set of these exercises (in order), each with its pre-fill worked out from the doc as
 * it stands then, so a weight typed on set 1 carries into the sets after it. A set with nothing to save (no typed
 * number, no coach target, no last time) is left open.
 */
export function markAll(
  log: WorkoutLogDoc,
  logExerciseIds: readonly string[],
  last: LastResults,
  nowIso: string,
  progression?: Progression,
): WorkoutLogDoc {
  let next = log;
  for (const exId of logExerciseIds) {
    const setIds = next.blocks.flatMap((b) => b.exercises.filter((e) => e.id === exId).flatMap((e) => e.sets.map((s) => s.id)));
    for (const setId of setIds) {
      const ex = next.blocks.flatMap((b) => b.exercises).find((e) => e.id === exId);
      const set = ex?.sets.find((s) => s.id === setId);
      if (!ex || !set || set.completedAt !== null) continue;
      const values = resolveSetValues(ex, setId, prefillSets(ex, last, progression));
      if (isEmpty(values)) continue;
      next = completeSetWith(next, setId, values, nowIso);
    }
  }
  return next;
}

/**
 * What VoiceOver should say when a number box's reason changes (AccessibilityInfo.announceForAccessibility): the new
 * reason when the box becomes invalid or the reason changes, else null, so it is never repeated on every key.
 */
export function invalidAnnouncement(previous: string | null, next: string | null): string | null {
  return next !== null && next !== previous ? next : null;
}

export type FinishDraft = { feel: Feeling | null; note: string };

/**
 * The finish sheet's feeling and note: taken from the saved workout note only as the sheet opens. While it is open
 * the client's own typing wins, even when the saved note changes underneath (a save on blur, a sync), so nothing
 * typed is overwritten.
 */
export function sheetDraft(o: { wasVisible: boolean; visible: boolean; draft: FinishDraft; saved: FinishDraft }): FinishDraft {
  return o.visible && !o.wasVisible ? o.saved : o.draft;
}

export type TypedResult = { kind: 'ok'; patch: ActualPatch } | { kind: 'invalid'; message: string };

const FIELD_HINT: Record<StepField, string> = {
  weight: 'Numbers only',
  reps: 'Whole reps only',
  duration: 'Use m:ss, like 1:30',
  distance: 'Numbers only',
};

/**
 * What a box's text means. Blank clears the field, except on a ticked set, where it is refused (the saved number
 * comes back when the box is left). Anything that can't be stored says why instead of being dropped silently.
 */
export function readTyped(field: StepField, text: string, units: Units, ticked: boolean): TypedResult {
  if (text.trim() === '') {
    return ticked ? { kind: 'invalid', message: 'A ticked set needs a number' } : { kind: 'ok', patch: typedPatch(field, null, units)! };
  }
  const v = parseActualInput(text, field);
  if (v === undefined || v === null) {
    const tooBig =
      (field === 'reps' && /^\d+$/.test(text.trim())) ||
      ((field === 'weight' || field === 'distance') && /^\d+([.,]\d*)?$/.test(text.trim()));
    return { kind: 'invalid', message: tooBig ? 'That’s more than a set can hold' : FIELD_HINT[field] };
  }
  const patch = typedPatch(field, v, units);
  return patch ? { kind: 'ok', patch } : { kind: 'invalid', message: 'That’s more than a set can hold' };
}

// ---------------------------------------------------------------------------------------------------------------
// Finish

export type FinishModel = {
  done: number;
  total: number;
  /** "25 of 27 done". */
  headline: string;
  /** "2 unticked won’t count", or null when all are ticked. */
  unticked: string | null;
  /** Nothing ticked: the workout can't be finished, only discarded. */
  noneDone: boolean;
};

/** The finish sheet's count (approved LT4 board): "1 of 11 done · 10 unticked won’t count". */
export function finishModel(log: WorkoutLogDoc): FinishModel {
  const done = completedSetCount(log);
  const open = openSetCount(log);
  const total = done + open;
  return {
    done,
    total,
    headline: `${done} of ${total} done`,
    unticked: open > 0 ? `${open} unticked won’t count` : null,
    noneDone: done === 0,
  };
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

/** True when switching this exercise to another option would clear numbers typed into its sets. */
export function hasTypedValues(ex: LogExerciseDoc): boolean {
  return ex.sets.some((s) => s.actualReps !== null || s.actualWeightKg !== null || s.actualDurationS !== null || s.actualDistanceM !== null);
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
