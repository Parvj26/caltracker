import { liveExercises, needsPick } from '../logs/flow';
import type { LogBlockDoc, WorkoutLogDoc } from '../logs/schema';
import type { BlockKind } from './schema';

/**
 * How many sets a workout has (product owner, 2026-11-19): EVERY tickable row counts, warm-ups and drops too, so Today,
 * the Workouts tab, the preview, the logger, its finish sheet, the summary and History all say the same number. A
 * pick-one group is a range (its smallest to its largest option) until an option is chosen, then that option's sets.
 */
export type SetRange = { min: number; max: number };

type CountBlock = { kind: BlockKind; exercises: ReadonlyArray<{ sets: ReadonlyArray<unknown> }> };

const ZERO: SetRange = { min: 0, max: 0 };
const add = (a: SetRange, b: SetRange): SetRange => ({ min: a.min + b.min, max: a.max + b.max });

/** One planned block's sets: all of them, or a pick-one group's smallest to largest option. */
export function blockSetRange(block: CountBlock): SetRange {
  if (block.kind === 'choice') {
    if (block.exercises.length === 0) return ZERO;
    const counts = block.exercises.map((e) => e.sets.length);
    return { min: Math.min(...counts), max: Math.max(...counts) };
  }
  const n = block.exercises.reduce((s, e) => s + e.sets.length, 0);
  return { min: n, max: n };
}

/** A planned workout's sets (warm-ups, working sets and drops; a pick-one group as a range). */
export function planSetRange(blocks: readonly CountBlock[]): SetRange {
  return blocks.reduce((r, b) => add(r, blockSetRange(b)), ZERO);
}

/** A logged block's sets: a pick-one group counts its pick once chosen, else the range of its options. */
export function logBlockSetRange(block: LogBlockDoc): SetRange {
  if (needsPick(block)) return blockSetRange(block);
  const n = liveExercises(block).reduce((s, { exercise }) => s + exercise.sets.length, 0);
  return { min: n, max: n };
}

/** A log's ticked sets and its total (exact, or a range while a pick-one group is still to choose). */
export function logSetCount(log: Pick<WorkoutLogDoc, 'blocks'>): { done: number; total: SetRange } {
  let done = 0;
  let total = ZERO;
  for (const b of log.blocks) {
    total = add(total, logBlockSetRange(b));
    for (const { exercise } of liveExercises(b)) done += exercise.sets.filter((s) => s.completedAt !== null).length;
  }
  return { done, total };
}

/**
 * Sets left unticked when a workout ends: every set not ticked, counting a pick-one group nobody chose from as its
 * smallest option (the least the client skipped).
 */
export function skippedSetCount(log: Pick<WorkoutLogDoc, 'blocks'>): number {
  const { done, total } = logSetCount(log);
  return Math.max(0, total.min - done);
}

/** "19", "18–19": the number alone ("6/18–19" on a small tab). */
export const setRangeNumber = (r: SetRange): string => (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);
const rangeNumber = setRangeNumber;

/** "19 sets", "1 set", "18–19 sets". */
export function setRangeText(r: SetRange): string {
  return `${rangeNumber(r)} ${r.min === r.max && r.min === 1 ? 'set' : 'sets'}`;
}

/** "6 of 19 sets", "6 of 18–19 sets", "1 of 1 set". */
export function setProgressText(done: number, total: SetRange): string {
  return `${done} of ${setRangeText(total)}`;
}
