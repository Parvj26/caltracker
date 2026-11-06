import { formatClock } from '../units/units';
import { groupDropSets } from '../workouts/drop-sets';
import type { LogBlockDoc, LogSetDoc, WorkoutLogDoc } from './schema';

export type StepKind = 'warmup' | 'normal' | 'drop';

export type Step = {
  exerciseIndex: number;
  setIndex: number;
  setId: string;
  kind: StepKind;
  /** 1-based group index within its exercise (a drop shares its main set's round). */
  round: number;
  /** 1-based position within its group; null for warm-up and normal sets. */
  dropNumber: number | null;
};

export type AfterDone =
  | { kind: 'drop'; dropNumber: number }
  | { kind: 'superset-next'; exerciseIndex: number }
  | { kind: 'rest'; seconds: number; round: number | null }
  | { kind: 'next'; round: number | null; pageDone: boolean }
  | { kind: 'last' };

/** Steps of one exercise as groups: [main set + its drops], with indexes into the exercise's sets. */
function exerciseGroups(block: LogBlockDoc, exerciseIndex: number): Step[][] {
  const sets = block.exercises[exerciseIndex]!.sets;
  const indexOf = new Map<LogSetDoc, number>(sets.map((s, i) => [s, i]));
  return groupDropSets(sets).map((g, gi) => {
    const main: Step = {
      exerciseIndex,
      setIndex: indexOf.get(g.set)!,
      setId: g.set.id,
      kind: g.set.setType === 'warmup' ? 'warmup' : 'normal',
      round: gi + 1,
      dropNumber: null,
    };
    const drops = g.drops.map(
      (d, di): Step => ({
        exerciseIndex,
        setIndex: indexOf.get(d)!,
        setId: d.id,
        kind: 'drop',
        round: gi + 1,
        dropNumber: di + 1,
      }),
    );
    return [main, ...drops];
  });
}

/** Straight: array order. Superset: round by round, A1 (and its drops), B1, A2, ... */
export function blockSteps(block: LogBlockDoc): Step[] {
  const groups = block.exercises.map((_, i) => exerciseGroups(block, i));
  if (block.kind !== 'superset') return groups.flat(2);
  const rounds = Math.max(0, ...groups.map((g) => g.length));
  const steps: Step[] = [];
  for (let r = 0; r < rounds; r += 1) {
    for (const g of groups) if (g[r]) steps.push(...g[r]!);
  }
  return steps;
}

/** The longest planned rest among a superset round's main sets (0 when none): what Done waits after the round. */
export function roundRestSeconds(block: LogBlockDoc, round: number): number {
  const mains = block.exercises.flatMap((_, i) => exerciseGroups(block, i)[round - 1]?.slice(0, 1) ?? []);
  return Math.max(0, ...mains.map((m) => setOf(block, m).target.restSeconds ?? 0));
}

export function blockRoundCount(block: LogBlockDoc): number {
  return Math.max(0, ...block.exercises.map((_, i) => exerciseGroups(block, i).length));
}

const setOf = (block: LogBlockDoc, s: Step): LogSetDoc => block.exercises[s.exerciseIndex]!.sets[s.setIndex]!;
const isOpen = (block: LogBlockDoc, s: Step) => setOf(block, s).completedAt === null;

/** First unticked step; with a preferred exercise, that exercise's first unticked step if it has one. */
export function currentStep(block: LogBlockDoc, preferExerciseIndex?: number): Step | null {
  const open = blockSteps(block).filter((s) => isOpen(block, s));
  if (preferExerciseIndex !== undefined) {
    const preferred = open.find((s) => s.exerciseIndex === preferExerciseIndex);
    if (preferred) return preferred;
  }
  return open[0] ?? null;
}

export function isBlockDone(block: LogBlockDoc): boolean {
  return block.exercises.every((ex) => ex.sets.every((s) => s.completedAt !== null));
}

/** The next page with an unticked set, going forward and then wrapping; never fromIndex itself. */
export function nextOpenBlock(log: WorkoutLogDoc, fromIndex: number): number | null {
  const n = log.blocks.length;
  for (let k = 1; k < n; k += 1) {
    const i = (fromIndex + k) % n;
    if (!isBlockDone(log.blocks[i]!)) return i;
  }
  return null;
}

/** What follows once setId (in log.blocks[blockIndex]) is completed. Decided as if it were already ticked. */
export function afterDone(log: WorkoutLogDoc, blockIndex: number, setId: string): AfterDone {
  const block = log.blocks[blockIndex]!;
  const openElsewhere = (b: LogBlockDoc) =>
    b.exercises.some((ex) => ex.sets.some((s) => s.id !== setId && s.completedAt === null));
  if (!log.blocks.some(openElsewhere)) return { kind: 'last' };

  const steps = blockSteps(block);
  const at = steps.findIndex((s) => s.setId === setId);
  const step = steps[at];
  if (!step) return { kind: 'next', round: null, pageDone: !openElsewhere(block) };

  const nextOpenInGroup = steps
    .slice(at + 1)
    .find((s) => s.exerciseIndex === step.exerciseIndex && s.round === step.round && isOpen(block, s));
  if (nextOpenInGroup && nextOpenInGroup.kind === 'drop') {
    return { kind: 'drop', dropNumber: nextOpenInGroup.dropNumber! };
  }

  const superset = block.kind === 'superset';
  if (superset) {
    // Another exercise in this round that is still open: prefer one after this step, else one before it.
    const others = steps.filter((s) => s.round === step.round && s.exerciseIndex !== step.exerciseIndex && isOpen(block, s));
    const target = others.find((s) => steps.indexOf(s) > at) ?? others[0];
    if (target) return { kind: 'superset-next', exerciseIndex: target.exerciseIndex };
  }

  // A drop chain rests with its main set; a superset round uses the longest rest in the round.
  const seconds = superset
    ? roundRestSeconds(block, step.round)
    : Math.max(
        0,
        ...steps
          .filter((s) => s.exerciseIndex === step.exerciseIndex && s.round === step.round && s.kind !== 'drop')
          .map((m) => setOf(block, m).target.restSeconds ?? 0),
      );
  const round = superset ? step.round : null;
  if (seconds > 0) return { kind: 'rest', seconds, round };
  return { kind: 'next', round, pageDone: !openElsewhere(block) };
}

/** The spec's label table; `letter` is the superset letter ("A") or null. */
export function doneLabel(after: AfterDone, letter: string | null): string {
  switch (after.kind) {
    case 'last':
      return 'Done · last set';
    case 'drop':
      return `Done · straight to drop ${after.dropNumber}`;
    case 'superset-next':
      return `Done · straight to ${letter ?? ''}${after.exerciseIndex + 1}`;
    case 'rest':
      return after.round === null
        ? `Done · start rest ${formatClock(after.seconds)}`
        : `Done round ${after.round} · rest ${formatClock(after.seconds)}`;
    case 'next':
      if (after.round !== null) return `Done round ${after.round}`;
      return after.pageDone ? 'Done · next exercise' : 'Done · next set';
  }
}
