import { describe, expect, it } from 'vitest';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { emptyLog, prefillActuals, startLogFromWorkout } from '../../src/logs/start';
import { fixtureWorkout, uuid } from './fixture';

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

  it('snapshots targets and prefills actuals', () => {
    const sets = exercises[0]!.sets;
    expect(sets[2]!.target.repsMax).toBe(10);
    expect(sets[2]!.actualReps).toBe(10);
    expect(sets[2]!.actualWeightKg).toBe(60);
    const drop = sets[4]!;
    expect(drop.target.toFailure).toBe(true);
    expect(drop.actualReps).toBeNull();
    for (const e of exercises) for (const s of e.sets) expect(s.completedAt).toBeNull();
  });

  it('produces a valid log', () => {
    expect(WorkoutLogDoc.safeParse(log).success).toBe(true);
  });
});

describe('prefillActuals', () => {
  it('falls back to repsMin and copies time and distance', () => {
    expect(prefillActuals({ repsMin: 5, repsMax: null, weightKg: null, durationS: 600, distanceM: 1000 })).toEqual({
      actualReps: 5,
      actualWeightKg: null,
      actualDurationS: 600,
      actualDistanceM: 1000,
    });
  });
});

describe('emptyLog', () => {
  it('parses with no blocks', () => {
    const l = emptyLog('Morning run', uuid, NOW);
    expect(WorkoutLogDoc.safeParse(l).success).toBe(true);
    expect(l.blocks).toHaveLength(0);
    expect(l.workoutId).toBeNull();
  });
});
