import { describe, expect, it } from 'vitest';
import { logBests } from '../../src/awards/prs';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { completedSetCount, logVolumeKg } from '../../src/logs/summary';
import { EX_A, EX_B, mkLog } from './helpers';

/**
 * A log whose second block is a pick-one group of EX_A (picked) and EX_B (not picked). The unpicked option
 * is given done sets on purpose: the server and the phone never allow that, but awards must not count them
 * even if a log ever arrived that way.
 */
function choiceLog(pickedIndex: 0 | 1 | null): WorkoutLogDoc {
  const base = mkLog([
    { sets: [{ w: 100, r: 5 }] },
    { exerciseId: EX_A, sets: [{ w: 20, r: 10, type: 'warmup' }, { w: 50, r: 10 }] },
    { exerciseId: EX_B, sets: [{ w: 200, r: 10 }, { w: 200, r: 10 }, { w: 200, r: 10 }] },
  ]);
  const [straight, a, b] = base.blocks as [WorkoutLogDoc['blocks'][number], WorkoutLogDoc['blocks'][number], WorkoutLogDoc['blocks'][number]];
  const options = [a.exercises[0]!, b.exercises[0]!];
  const choice = {
    ...a,
    kind: 'choice' as const,
    exercises: options,
    pickedExerciseId: pickedIndex === null ? null : options[pickedIndex]!.id,
  };
  return { ...base, blocks: [straight, choice] };
}

describe('awards count only the picked option of a pick-one group', () => {
  it('volume and set count leave out the unpicked option and warm-ups', () => {
    const log = choiceLog(0);
    expect(logVolumeKg(log)).toBe(100 * 5 + 50 * 10);
    expect(completedSetCount(log)).toBe(3);
  });

  it('an unpicked group counts nothing', () => {
    const log = choiceLog(null);
    expect(logVolumeKg(log)).toBe(500);
    expect(completedSetCount(log)).toBe(1);
  });

  it('personal bests come only from the picked option', () => {
    const bests = logBests(choiceLog(0));
    expect(bests.some((r) => r.exerciseId === EX_B)).toBe(false);
    expect(bests.find((r) => r.exerciseId === EX_A && r.kind === 'heaviest')?.valueKg).toBe(100);
  });

  it('picking the other option counts that option instead', () => {
    expect(logVolumeKg(choiceLog(1))).toBe(100 * 5 + 200 * 30);
    expect(logBests(choiceLog(1)).some((r) => r.exerciseId === EX_B)).toBe(true);
  });
});
