import { describe, expect, it } from 'vitest';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import { fixtureWorkout, uuid } from './fixture';

const NOW = '2026-11-05T10:00:00.000Z';
const base = () => startLogFromWorkout(fixtureWorkout(), uuid, NOW);

function messages(input: unknown) {
  const r = WorkoutLogDoc.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => ({ message: i.message, path: i.path }));
}

describe('WorkoutLogDoc', () => {
  it('rejects a completed log with no completed set', () => {
    expect(messages({ ...base(), status: 'completed', finishedAt: NOW })).toEqual([
      { message: 'Complete at least one set to finish.', path: ['status'] },
    ]);
  });

  it('accepts a completed log with one completed set', () => {
    const l = base();
    l.blocks[0]!.exercises[0]!.sets[1]!.completedAt = NOW;
    expect(WorkoutLogDoc.safeParse({ ...l, status: 'completed', finishedAt: NOW }).success).toBe(true);
  });

  it('rejects 1001 reps', () => {
    const l = base();
    l.blocks[0]!.exercises[0]!.sets[1]!.actualReps = 1001;
    expect(WorkoutLogDoc.safeParse(l).success).toBe(false);
  });

  it('allows unequal superset rounds', () => {
    const l = base();
    const ss = l.blocks[1]!;
    const extra = { ...ss.exercises[1]!.sets[0]!, id: uuid() };
    ss.exercises[1]!.sets.push(extra);
    expect(ss.exercises.map((e) => e.sets.length)).toEqual([3, 4]);
    expect(WorkoutLogDoc.safeParse(l).success).toBe(true);
  });

  it('rejects a leading drop and a one-exercise superset', () => {
    const l = base();
    l.blocks[0]!.exercises[0]!.sets[0]!.setType = 'drop';
    l.blocks[1]!.exercises.pop();
    expect(messages(l)).toEqual([
      { message: 'A drop set must follow a normal or warm-up set.', path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'setType'] },
      { message: 'A superset needs at least two exercises.', path: ['blocks', 1, 'exercises'] },
    ]);
  });
});
