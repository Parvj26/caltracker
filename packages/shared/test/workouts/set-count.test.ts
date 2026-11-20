import { describe, expect, it } from 'vitest';
import { completeSet, pickChoice } from '../../src/logs/ops';

import { startLogFromWorkout } from '../../src/logs/start';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { WorkoutDoc } from '../../src/workouts/schema';
import {
  blockSetRange,
  logSetCount,
  planSetRange,
  setProgressText,
  setRangeText,
  skippedSetCount,
} from '../../src/workouts/set-count';
import { uuid } from '../logs/fixture';

const NOW = '2026-11-19T10:00:00.000Z';
const set = (setType: 'warmup' | 'normal' | 'drop' = 'normal') => ({
  id: uuid(),
  setType,
  targetRepsMin: 8,
  targetRepsMax: 8,
  targetWeightKg: 60,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 60,
  note: null,
});
const ex = (sets: unknown[]) => ({ id: uuid(), exerciseId: uuid(), exerciseName: 'Squat', trackingType: 'weight_reps', note: null, sets });

/** Straight [W, 3 working, drop] = 5, superset 2 × 3 = 6, pick one of [6 sets] or [5 sets]. */
function plan(): WorkoutDoc {
  return WorkoutDoc.parse({
    id: uuid(),
    name: 'Lower Body',
    notes: null,
    blocks: [
      { id: uuid(), kind: 'straight', exercises: [ex([set('warmup'), set(), set(), set(), set('drop')])] },
      { id: uuid(), kind: 'superset', exercises: [ex([set(), set(), set()]), ex([set(), set(), set()])] },
      { id: uuid(), kind: 'choice', exercises: [ex([set(), set(), set(), set(), set(), set()]), ex([set(), set(), set(), set(), set()])] },
    ],
  });
}

describe('set counts (every tickable row counts)', () => {
  it('counts warm-ups and drops, and a pick-one group as a range', () => {
    const doc = plan();
    expect(blockSetRange(doc.blocks[0]!)).toEqual({ min: 5, max: 5 });
    expect(blockSetRange(doc.blocks[2]!)).toEqual({ min: 5, max: 6 });
    expect(planSetRange(doc.blocks)).toEqual({ min: 16, max: 17 });
  });

  it('a log agrees with its plan until the pick, then is exact', () => {
    const doc = plan();
    let log: WorkoutLogDoc = startLogFromWorkout(doc, uuid, NOW);
    expect(logSetCount(log)).toEqual({ done: 0, total: { min: 16, max: 17 } });
    const choice = log.blocks[2]!;
    log = pickChoice(log, choice.id, choice.exercises[1]!.id, NOW);
    expect(logSetCount(log).total).toEqual({ min: 16, max: 16 });
    log = completeSet(log, log.blocks[0]!.exercises[0]!.sets[0]!.id, NOW);
    log = completeSet(log, log.blocks[0]!.exercises[0]!.sets[4]!.id, NOW);
    expect(logSetCount(log).done).toBe(2);
    expect(skippedSetCount(log)).toBe(14);
  });

  it('skipped counts an unchosen pick-one group as its smallest option', () => {
    const log = startLogFromWorkout(plan(), uuid, NOW);
    expect(skippedSetCount(log)).toBe(16);
  });

  it('words the count and the progress', () => {
    expect(setRangeText({ min: 19, max: 19 })).toBe('19 sets');
    expect(setRangeText({ min: 1, max: 1 })).toBe('1 set');
    expect(setRangeText({ min: 18, max: 19 })).toBe('18–19 sets');
    expect(setProgressText(6, { min: 19, max: 19 })).toBe('6 of 19 sets');
    expect(setProgressText(6, { min: 18, max: 19 })).toBe('6 of 18–19 sets');
  });
});
