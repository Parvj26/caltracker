// What one logging page shows, worked out from the log. Pure (no React): the page components only draw it.
// Every rule (pre-fill, step order, Done labels, wording) comes from @caltracker/shared; this file only lays it out.
import {
  TARGET_FIELDS,
  afterDone,
  blockRoundCount,
  blockSteps,
  coachLine,
  currentStep,
  distanceUnitFor,
  doneLabel,
  formatClock,
  formatLastResult,
  formatLogSetTarget,
  formatResult,
  fromMeters,
  isBlockDone,
  isChoiceLocked,
  liveExercises,
  needsPick,
  pickChoice,
  kgToInput,
  nextOpenBlock,
  sectionPlace,
  sectionRuns,
  planSummary,
  resolveSetValues,
  roundRestSeconds,
  stepName,
  type AfterDone,
  type LogBlockDoc,
  type LogExerciseDoc,
  type LogSetDoc,
  type SetValues,
  type Step,
  type StepField,
  type StepKind,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import type { LastResults } from './log-api';
import { orList, supersetLetters } from './workouts';

export type StepperModel = {
  field: StepField;
  unit: string;
  value: number | null;
  display: string;
  lessLabel: string;
  moreLabel: string;
};

export type StepRowModel = {
  setId: string;
  exerciseIndex: number;
  setIndex: number;
  kind: StepKind;
  chip: string;
  name: string;
  text: string;
  done: boolean;
  current: boolean;
};

export type ExerciseCardModel = {
  exerciseIndex: number;
  logExerciseId: string;
  exerciseId: string;
  name: string;
  label: string | null;
  reference: string | null;
  swapped: boolean;
  note: string | null;
  collapsedText: string | null;
  active: boolean;
};

export type ChoiceModel = {
  heading: string;
  options: Array<{ logExerciseId: string; exerciseId: string; name: string; plan: string | null }>;
  picked: boolean;
  /** True until the picked option has a done set (so also true before any pick). */
  canSwitch: boolean;
  pickedLine: string | null;
};

export type SectionPlace = { name: string; at: number; of: number };

export type PageModel = {
  blockIndex: number;
  kind: 'straight' | 'superset' | 'choice';
  /** Where the page sits in its section ("Core (Activation)", 1 of 2); null when it has no section. */
  section: SectionPlace | null;
  /** Set on pick-one pages only. When picked, the rest of the model describes just the picked option. */
  choice: ChoiceModel | null;
  exercises: ExerciseCardModel[];
  current: null | {
    step: Step;
    setName: string;
    dots: Array<'done' | 'current' | 'todo' | 'warmup-done' | 'warmup-todo'>;
    values: SetValues;
    steppers: StepperModel[];
    bodyTile: boolean;
    dropSteps: StepRowModel[] | null;
    doneLabel: string;
    after: AfterDone;
  };
  round: null | {
    current: number;
    total: number;
    restText: string | null;
    chips: Array<'done' | 'current' | 'todo'>;
    afterRound: string | null;
  };
  steps: StepRowModel[];
  hasWarmups: boolean;
  allDone: boolean;
  /** Every set of every page is ticked: the all-done card offers Finish workout, not Next exercise. */
  workoutDone: boolean;
  nextLine: string | null;
  upNext: string | null;
};

type Progress = 'done' | 'current' | 'todo';

const FIELD_ORDER: readonly StepField[] = ['weight', 'reps', 'duration', 'distance'];

const STEPPER_WORDS: Record<StepField, { less: string; more: string }> = {
  weight: { less: 'Less weight', more: 'More weight' },
  reps: { less: 'Fewer reps', more: 'More reps' },
  duration: { less: 'Less time', more: 'More time' },
  distance: { less: 'Less distance', more: 'More distance' },
};

/** "1 second" / "5 seconds": the spoken rest time. */
export function restLeftLabel(seconds: number): string {
  const n = Math.max(0, Math.round(seconds));
  return `${n} ${n === 1 ? 'second' : 'seconds'} of rest left`;
}

function stepperFor(field: StepField, values: SetValues, units: Units): StepperModel {
  const words = STEPPER_WORDS[field];
  const base = { field, lessLabel: words.less, moreLabel: words.more };
  switch (field) {
    case 'weight': {
      const v = values.weightKg;
      return { ...base, unit: units, value: v, display: v === null ? '' : String(kgToInput(v, units)) };
    }
    case 'reps': {
      const v = values.reps;
      return { ...base, unit: 'reps', value: v, display: v === null ? '' : String(v) };
    }
    case 'duration': {
      const v = values.durationS;
      return { ...base, unit: 'm:ss', value: v, display: v === null ? '' : formatClock(v) };
    }
    case 'distance': {
      const v = values.distanceM;
      const unit = distanceUnitFor(units);
      return { ...base, unit, value: v, display: v === null ? '' : String(fromMeters(v, unit)) };
    }
  }
}

const setValuesOf = (s: LogSetDoc): SetValues => ({
  reps: s.actualReps,
  weightKg: s.actualWeightKg,
  durationS: s.actualDurationS,
  distanceM: s.actualDistanceM,
});

function stepRow(ex: LogExerciseDoc, step: Step, units: Units, currentId: string | null): StepRowModel {
  const set = ex.sets[step.setIndex];
  const done = set.completedAt !== null;
  const plan = formatLogSetTarget(set.target, ex.trackingType, units);
  const text = done ? (formatResult(setValuesOf(set), ex.trackingType, units) ?? '') : plan === '—' ? '' : plan;
  const chip =
    step.kind === 'warmup'
      ? 'W'
      : step.kind === 'drop'
        ? '↳'
        : String(ex.sets.slice(0, step.setIndex + 1).filter((s) => s.setType === 'normal').length);
  return {
    setId: step.setId,
    exerciseIndex: step.exerciseIndex,
    setIndex: step.setIndex,
    kind: step.kind,
    chip,
    name: stepName(ex, step.setIndex),
    text,
    done,
    current: step.setId === currentId,
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "A or B" (two options) or "A, B or C": the option names of a pick-one group. */
function optionNames(block: LogBlockDoc): string {
  return orList(block.exercises.map((e) => e.exerciseName));
}

/** "Core (Activation) · 1 of 2". */
export function sectionLine(place: SectionPlace): string {
  return `${place.name} · ${place.at} of ${place.of}`;
}

/** "Bench press" or "A1 Pull-up + A2 Push-up". */
function pageTitle(block: LogBlockDoc, letter: string | null): string {
  if (block.kind === 'choice') {
    const live = liveExercises(block)[0];
    return live ? live.exercise.exerciseName : `Pick one: ${optionNames(block)}`;
  }
  if (block.kind !== 'superset') return block.exercises[0].exerciseName;
  return block.exercises.map((e, i) => `${letter ?? ''}${i + 1} ${e.exerciseName}`).join(' + ');
}

export function buildPageModel(i: {
  log: WorkoutLogDoc;
  blockIndex: number;
  units: Units;
  last: LastResults;
  preferExerciseIndex?: number;
}): PageModel {
  const { log, blockIndex, units, last } = i;
  const block = log.blocks[blockIndex];
  const superset = block.kind === 'superset';
  const letters = supersetLetters(log.blocks);
  const letter = letters[blockIndex] ?? null;
  const labelOf = (exIndex: number) => (superset ? `${letter ?? ''}${exIndex + 1}` : null);
  const allSteps = blockSteps(block);
  const cur = currentStep(block, i.preferExerciseIndex);
  const lastSets = (ex: LogExerciseDoc) => last[ex.exerciseId]?.sets ?? [];

  const live = liveExercises(block);
  const exercises: ExerciseCardModel[] = live.map(({ exercise: ex, exerciseIndex }) => {
    const active = cur !== null && cur.exerciseIndex === exerciseIndex;
    // The set the coach line talks about: the current one, else the first working set.
    const refIndex = active ? cur.setIndex : Math.max(0, ex.sets.findIndex((s) => s.setType === 'normal'));
    const parts = [coachLine(ex, refIndex, units), formatLastResult(lastSets(ex), ex.trackingType, units)].filter(
      (p): p is string => p !== null,
    );
    let collapsedText: string | null = null;
    if (superset && cur !== null && !active) {
      const main = allSteps.find((s) => s.exerciseIndex === exerciseIndex && s.round === cur.round && s.kind !== 'drop');
      const set = main ? ex.sets[main.setIndex] : null;
      if (set) {
        if (set.completedAt !== null) {
          const result = formatResult(setValuesOf(set), ex.trackingType, units);
          collapsedText = result === null ? 'Done' : `Done · ${result}`;
        } else {
          const plan = formatLogSetTarget(set.target, ex.trackingType, units);
          collapsedText = plan === '—' ? 'Up next' : `Up next · ${plan}`;
        }
      }
    }
    return {
      exerciseIndex,
      logExerciseId: ex.id,
      exerciseId: ex.exerciseId,
      name: ex.exerciseName,
      label: labelOf(exerciseIndex),
      reference: parts.length > 0 ? parts.join(' · ') : null,
      swapped: ex.swappedFromExerciseId !== null,
      note: ex.note,
      collapsedText,
      active,
    };
  });

  const steps = allSteps.map((s) => stepRow(block.exercises[s.exerciseIndex], s, units, cur?.setId ?? null));

  let current: PageModel['current'] = null;
  let nextLine: string | null = null;
  if (cur) {
    const ex = block.exercises[cur.exerciseIndex];
    const values = resolveSetValues(ex, cur.setId, lastSets(ex));
    const fields = FIELD_ORDER.filter((f) => TARGET_FIELDS[ex.trackingType].includes(f));
    // A drop's dot is its main set's: walk back to the set that starts the group.
    let mainIndex = cur.setIndex;
    while (ex.sets[mainIndex].setType === 'drop' && mainIndex > 0) mainIndex -= 1;
    // One dot per warm-up or working set; a drop has none and shows as its main set's dot (the current one).
    const dots = ex.sets.flatMap((s, si): Array<'done' | 'current' | 'todo' | 'warmup-done' | 'warmup-todo'> => {
      if (s.setType === 'drop') return [];
      if (si === mainIndex) return ['current'];
      const done = s.completedAt !== null;
      if (s.setType === 'warmup') return [done ? 'warmup-done' : 'warmup-todo'];
      return [done ? 'done' : 'todo'];
    });
    const groupSteps = allSteps.filter((s) => s.exerciseIndex === cur.exerciseIndex && s.round === cur.round);
    const hasDrops = groupSteps.some((s) => s.kind === 'drop');
    const after = afterDone(log, blockIndex, cur.setId);
    current = {
      step: cur,
      setName: stepName(ex, cur.setIndex),
      dots,
      values,
      steppers: fields.map((f) => stepperFor(f, values, units)),
      bodyTile: ex.trackingType === 'reps',
      dropSteps: hasDrops ? groupSteps.map((s) => stepRow(ex, s, units, cur.setId)) : null,
      doneLabel: doneLabel(after, letter),
      after,
    };
    const numbers = formatResult(values, ex.trackingType, units);
    const prefix = superset ? `${labelOf(cur.exerciseIndex)} ` : '';
    nextLine = [`${prefix}${ex.exerciseName}`, lowerFirst(stepName(ex, cur.setIndex)), numbers]
      .filter((p): p is string => p !== null)
      .join(' · ');
  }

  let round: PageModel['round'] = null;
  if (superset && cur) {
    const total = blockRoundCount(block);
    const secs = roundRestSeconds(block, cur.round);
    const chips: Progress[] = Array.from({ length: total }, (_, r) => {
      const inRound = allSteps.filter((s) => s.round === r + 1);
      if (r + 1 === cur.round) return 'current';
      return inRound.every((s) => block.exercises[s.exerciseIndex].sets[s.setIndex].completedAt !== null) ? 'done' : 'todo';
    });
    let afterRound: string | null = null;
    if (cur.round < total) {
      const first = allSteps.find((s) => s.round === cur.round + 1);
      if (first) afterRound = `Round ${cur.round + 1} · ${labelOf(first.exerciseIndex)} ${block.exercises[first.exerciseIndex].exerciseName}`;
    } else if (blockIndex + 1 < log.blocks.length) {
      afterRound = log.blocks[blockIndex + 1] ? pageTitle(log.blocks[blockIndex + 1], letters[blockIndex + 1] ?? null) : null;
    }
    round = {
      current: cur.round,
      total,
      restText: secs > 0 ? `Rest ${formatClock(secs)} after ${block.exercises.length === 2 ? 'both' : 'all'}` : null,
      chips,
      afterRound,
    };
  }

  let upNext: string | null = null;
  const nextBlock = log.blocks[blockIndex + 1];
  if (nextBlock) {
    const title = pageTitle(nextBlock, letters[blockIndex + 1] ?? null);
    if (needsPick(nextBlock)) {
      upNext = `Pick one · ${optionNames(nextBlock)}`;
    } else {
      const only = nextBlock.kind === 'superset' ? null : liveExercises(nextBlock)[0]?.exercise;
      const plan = only ? planSummary(only, units) : null;
      upNext = plan === null ? title : `${title} · ${plan}`;
    }
  }

  const section = sectionPlace(log.blocks, log.sections, blockIndex);
  let choice: ChoiceModel | null = null;
  if (block.kind === 'choice') {
    const picked = !needsPick(block);
    choice = {
      heading: section ? `${section.name} · pick one` : 'Pick one',
      options: block.exercises.map((ex) => ({
        logExerciseId: ex.id,
        exerciseId: ex.exerciseId,
        name: ex.exerciseName,
        plan: planSummary(ex, units),
      })),
      picked,
      canSwitch: !isChoiceLocked(block),
      pickedLine: picked ? `Picked from ${block.exercises.length} options` : null,
    };
  }

  return {
    blockIndex,
    kind: block.kind,
    section,
    choice,
    exercises,
    current,
    round,
    steps,
    hasWarmups: block.exercises.some((e) => e.sets.some((s) => s.setType === 'warmup')),
    allDone: isBlockDone(block),
    workoutDone: log.blocks.every(isBlockDone),
    nextLine,
    upNext,
  };
}

/** One state per page: done (every set ticked), current (on screen), to-do. The current page wins. */
export function progressStates(log: WorkoutLogDoc, pageIndex: number): Progress[] {
  return log.blocks.map((b, i) => (i === pageIndex ? 'current' : isBlockDone(b) ? 'done' : 'todo'));
}

/** "Exercise 2 of 5. 1 done." for screen readers. */
export function progressLabel(states: ReadonlyArray<Progress>): string {
  const at = states.indexOf('current');
  const done = states.filter((s) => s === 'done').length;
  return `Exercise ${at < 0 ? 0 : at + 1} of ${states.length}. ${done} done.`;
}

/**
 * A tap on a pick-one card: picks only while nothing is picked yet, so two quick taps on different cards cannot
 * flip the pick. Changing it goes through Switch (clear the pick) first.
 */
export function pickFirstOnly(log: WorkoutLogDoc, blockId: string, logExerciseId: string, nowIso: string): WorkoutLogDoc {
  const block = log.blocks.find((b) => b.id === blockId);
  if (!block || block.pickedExerciseId !== null) return log;
  return pickChoice(log, blockId, logExerciseId, nowIso);
}

/** The progress strip in groups: one array of page states per section run (one group when there are no sections). */
export function progressGroups(log: WorkoutLogDoc, pageIndex: number): Progress[][] {
  const states = progressStates(log, pageIndex);
  return sectionRuns(log.blocks, log.sections).map((run) => run.blockIndexes.map((i) => states[i]));
}

export type ListRow = { pageIndex: number; title: string; detail: string; done: boolean };

/**
 * The exercise list: one row per page, grouped under section headings. Pages with no section get a null heading;
 * a section with no pages left has no run, so it shows no heading.
 */
export function listSections(log: WorkoutLogDoc): Array<{ heading: string | null; rows: ListRow[] }> {
  const letters = supersetLetters(log.blocks);
  const row = (i: number): ListRow => {
    const b = log.blocks[i];
    if (needsPick(b)) return { pageIndex: i, title: pageTitle(b, null), detail: 'Not picked yet', done: false };
    const sets = liveExercises(b).flatMap(({ exercise }) => exercise.sets.filter((x) => x.setType === 'normal'));
    const ticked = sets.filter((s) => s.completedAt !== null).length;
    return {
      pageIndex: i,
      title: pageTitle(b, letters[i] ?? null),
      detail: `${ticked} of ${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`,
      done: isBlockDone(b),
    };
  };
  return sectionRuns(log.blocks, log.sections).map((run) => ({
    heading: run.section?.name ?? null,
    rows: run.blockIndexes.map(row),
  }));
}

/** Keeps the same page on screen after the pages change; if it is gone, stays at the same place (or the last). */
export function pageIndexAfterChange(prev: { blockIds: string[]; index: number }, nextBlockIds: string[]): number {
  if (nextBlockIds.length === 0) return 0;
  const kept = nextBlockIds.indexOf(prev.blockIds[prev.index] ?? '');
  if (kept >= 0) return kept;
  return Math.min(Math.max(0, prev.index), nextBlockIds.length - 1);
}

/** The page to show after Done: the same one while it has open sets, else the next open one (wrapping), else stay. */
export function pageAfterDone(log: WorkoutLogDoc, pageIndex: number): number {
  const block = log.blocks[pageIndex];
  if (block && !isBlockDone(block)) return pageIndex;
  return nextOpenBlock(log, pageIndex) ?? pageIndex;
}

/** The page shown on opening: the first not done (an unpicked pick-one group counts); 0 when none, or no pages. */
export function firstOpenPage(log: WorkoutLogDoc): number {
  const i = log.blocks.findIndex((b) => !isBlockDone(b));
  return i < 0 ? 0 : i;
}
