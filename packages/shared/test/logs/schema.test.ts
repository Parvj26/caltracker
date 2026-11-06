import { describe, expect, it } from 'vitest';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import { fixtureSectionedWorkout, fixtureWorkout, uuid } from './fixture';

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

describe('WorkoutLogDoc sections and picks', () => {
  const sectioned = () => startLogFromWorkout(fixtureSectionedWorkout(), uuid, NOW);

  it('parses a pre-sections log', () => {
    const old = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete old.sections;
    for (const b of old.blocks as Array<Record<string, unknown>>) {
      delete b.sectionId;
      delete b.pickedExerciseId;
    }
    const r = WorkoutLogDoc.parse(old);
    expect(r.sections).toEqual([]);
    expect(r.blocks.every((b) => b.sectionId === null && b.pickedExerciseId === null)).toBe(true);
  });

  it('accepts a sectioned log with a pick', () => {
    const l = sectioned();
    const choice = l.blocks.find((b) => b.kind === 'choice')!;
    choice.pickedExerciseId = choice.exercises[0]!.id;
    expect(WorkoutLogDoc.safeParse(l).success).toBe(true);
  });

  it('rejects an unknown section', () => {
    const l = sectioned();
    l.blocks[0]!.sectionId = uuid();
    expect(messages(l)).toEqual([{ message: 'Unknown section.', path: ['blocks', 0, 'sectionId'] }]);
  });

  it('rejects a pick on a non-choice block', () => {
    const l = sectioned();
    l.blocks[0]!.pickedExerciseId = l.blocks[0]!.exercises[0]!.id;
    expect(messages(l)).toEqual([{ message: 'Only a pick-one group can have a pick.', path: ['blocks', 0, 'pickedExerciseId'] }]);
  });

  it('rejects a pick that is not in the block', () => {
    const l = sectioned();
    const i = l.blocks.findIndex((b) => b.kind === 'choice');
    l.blocks[i]!.pickedExerciseId = uuid();
    expect(messages(l)).toEqual([{ message: "The pick must be one of the group's exercises.", path: ['blocks', i, 'pickedExerciseId'] }]);
  });

  it('rejects a done set in an unpicked option', () => {
    const l = sectioned();
    const i = l.blocks.findIndex((b) => b.kind === 'choice');
    const choice = l.blocks[i]!;
    choice.pickedExerciseId = choice.exercises[0]!.id;
    choice.exercises[1]!.sets[0]!.completedAt = NOW;
    expect(messages(l)).toEqual([
      { message: 'Only the picked option can have done sets.', path: ['blocks', i, 'exercises', 1, 'sets', 0, 'completedAt'] },
    ]);
  });

  it('rejects a done set in a pick-one group with no pick', () => {
    const l = sectioned();
    const i = l.blocks.findIndex((b) => b.kind === 'choice');
    l.blocks[i]!.exercises[0]!.sets[0]!.completedAt = NOW;
    expect(messages(l)).toHaveLength(1);
  });

  it('rejects a choice with fewer than 2 exercises', () => {
    const l = sectioned();
    const i = l.blocks.findIndex((b) => b.kind === 'choice');
    l.blocks[i]!.exercises.pop();
    expect(messages(l)).toEqual([{ message: 'A pick-one group needs 2 to 5 exercises.', path: ['blocks', i, 'exercises'] }]);
  });
});
