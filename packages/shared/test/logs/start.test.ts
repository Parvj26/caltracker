import { describe, expect, it } from 'vitest';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { emptyLog, startLogFromWorkout } from '../../src/logs/start';
import { fixtureSectionedWorkout, fixtureWorkout, uuid } from './fixture';

const NOW = '2026-11-05T10:00:00.000Z';

describe('startLogFromWorkout', () => {
  const workout = fixtureWorkout();
  const log = startLogFromWorkout(workout, uuid, NOW);
  const exercises = log.blocks.flatMap((b) => b.exercises);

  it('copies the structure and starts in progress', () => {
    expect(log.blocks).toHaveLength(2);
    expect(exercises).toHaveLength(3);
    expect(log).toMatchObject({
      status: 'in_progress',
      revision: 0,
      autoFinished: false,
      workoutId: workout.id,
      name: 'Upper A',
      startedAt: NOW,
      lastActivityAt: NOW,
      finishedAt: null,
    });
  });

  it('uses new ids everywhere and links planned exercises', () => {
    const sourceIds = new Set<string>([workout.id]);
    for (const b of workout.blocks) {
      sourceIds.add(b.id);
      for (const e of b.exercises) {
        sourceIds.add(e.id);
        e.sets.forEach((s) => sourceIds.add(s.id));
      }
    }
    const newIds = [log.id, ...log.blocks.flatMap((b) => [b.id, ...b.exercises.flatMap((e) => [e.id, ...e.sets.map((s) => s.id)])])];
    expect(new Set(newIds).size).toBe(newIds.length);
    for (const id of newIds) expect(sourceIds.has(id)).toBe(false);
    expect(exercises.map((e) => e.plannedWorkoutExerciseId)).toEqual(workout.blocks.flatMap((b) => b.exercises.map((e) => e.id)));
  });

  it('snapshots targets and leaves actuals empty', () => {
    const sets = exercises[0]!.sets;
    expect(sets[2]!.target.repsMax).toBe(10);
    expect(sets[2]!.target.weightKg).toBe(60);
    for (const e of exercises) for (const x of e.sets) expect([x.actualReps, x.actualWeightKg, x.actualDurationS, x.actualDistanceM]).toEqual([null, null, null, null]);
    const drop = sets[4]!;
    expect(drop.target.toFailure).toBe(true);
    expect(drop.actualReps).toBeNull();
    for (const e of exercises) for (const s of e.sets) expect(s.completedAt).toBeNull();
  });

  it('produces a valid log', () => {
    expect(WorkoutLogDoc.safeParse(log).success).toBe(true);
  });
});

describe('startLogFromWorkout with sections', () => {
  const workout = fixtureSectionedWorkout();
  const log = startLogFromWorkout(workout, uuid, NOW);

  it('copies sections, section ids and kinds, with nothing picked', () => {
    expect(log.blocks).toHaveLength(6);
    expect(log.sections).toEqual(workout.sections);
    expect(log.blocks.map((b) => b.sectionId)).toEqual(workout.blocks.map((b) => b.sectionId));
    expect(log.blocks.map((b) => b.kind)).toEqual(workout.blocks.map((b) => b.kind));
    expect(log.blocks.every((b) => b.pickedExerciseId === null)).toBe(true);
  });

  it('keeps both options of the pick-one group linked to their plan ids', () => {
    const i = workout.blocks.findIndex((b) => b.kind === 'choice');
    expect(log.blocks[i]!.exercises).toHaveLength(2);
    expect(log.blocks[i]!.exercises.map((e) => e.plannedWorkoutExerciseId)).toEqual(workout.blocks[i]!.exercises.map((e) => e.id));
  });

  it('produces a valid log', () => {
    expect(WorkoutLogDoc.safeParse(log).success).toBe(true);
  });
});

describe('emptyLog', () => {
  it('parses with no blocks', () => {
    const l = emptyLog('Morning run', uuid, NOW);
    expect(WorkoutLogDoc.safeParse(l).success).toBe(true);
    expect(l.blocks).toHaveLength(0);
    expect(l.workoutId).toBeNull();
    expect(l.sections).toEqual([]);
  });
});
