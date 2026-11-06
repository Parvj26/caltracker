import { describe, expect, it } from 'vitest';
import { coachSessionState, completeAllSets, isLoggedByCoach, loggerKind } from '../../src/logs/coach-session';
import { completeSet, pickChoice, setLogNotes, updateActual } from '../../src/logs/ops';
import { startLogFromWorkout } from '../../src/logs/start';
import type { WorkoutLogDoc } from '../../src/logs/schema';
import { fixtureSectionedWorkout, fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-06T10:00:00.000Z';
const T1 = '2026-11-06T10:05:00.000Z';
const start = (): WorkoutLogDoc => startLogFromWorkout(fixtureWorkout(), uuid, T0);
const allSets = (log: WorkoutLogDoc) => log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets));

describe('isLoggedByCoach', () => {
  it('is true only when someone other than the client logged it', () => {
    expect(isLoggedByCoach({ loggedBy: 'coach', clientId: 'client' })).toBe(true);
    expect(isLoggedByCoach({ loggedBy: 'client', clientId: 'client' })).toBe(false);
    // A deleted account (or a seeded log) has no logger: it stays the client's own.
    expect(isLoggedByCoach({ loggedBy: null, clientId: 'client' })).toBe(false);
  });
});

describe('coachSessionState', () => {
  const base = { workoutId: 'w1', coachId: 'coach', clientId: 'client' };

  it('starts a new session when nothing is logged', () => {
    expect(coachSessionState({ ...base, logs: [] })).toEqual({ kind: 'start' });
    expect(coachSessionState({ ...base, logs: [{ id: 'x', workoutId: 'w1', status: 'discarded', loggedBy: 'client', name: 'A' }] })).toEqual({
      kind: 'start',
    });
  });

  it('opens a finished log of this workout', () => {
    expect(coachSessionState({ ...base, logs: [{ id: 'd', workoutId: 'w1', status: 'completed', loggedBy: 'client', name: 'A' }] })).toEqual({
      kind: 'done',
      logId: 'd',
    });
  });

  it('resumes the coach’s own session', () => {
    expect(coachSessionState({ ...base, logs: [{ id: 'm', workoutId: 'w1', status: 'in_progress', loggedBy: 'coach', name: 'A' }] })).toEqual({
      kind: 'mine',
      logId: 'm',
    });
  });

  it('shows the client is logging this workout on the phone (a missing logger counts as the client)', () => {
    for (const loggedBy of ['client', null]) {
      expect(coachSessionState({ ...base, logs: [{ id: 'p', workoutId: 'w1', status: 'in_progress', loggedBy, name: 'A' }] })).toEqual({
        kind: 'client_logging',
        logId: 'p',
      });
    }
  });

  it('tells another coach of the workspace apart from the client', () => {
    expect(coachSessionState({ ...base, logs: [{ id: 'c', workoutId: 'w1', status: 'in_progress', loggedBy: 'coach-2', name: 'A' }] })).toEqual({
      kind: 'other_coach_logging',
      logId: 'c',
      loggedBy: 'coach-2',
    });
  });

  it('says another workout is in progress (one at a time per client)', () => {
    expect(coachSessionState({ ...base, logs: [{ id: 'o', workoutId: 'w2', status: 'in_progress', loggedBy: 'client', name: 'Legs' }] })).toEqual({
      kind: 'other_workout',
      logId: 'o',
      name: 'Legs',
      byCoach: false,
    });
  });

  it('prefers an in-progress session of this workout over an older finished one', () => {
    const logs = [
      { id: 'd', workoutId: 'w1', status: 'completed' as const, loggedBy: 'client', name: 'A' },
      { id: 'm', workoutId: 'w1', status: 'in_progress' as const, loggedBy: 'coach', name: 'A' },
    ];
    expect(coachSessionState({ ...base, logs })).toEqual({ kind: 'mine', logId: 'm' });
  });
});

describe('completeAllSets', () => {
  it('ticks every open set of the block with its pre-filled numbers, keeping ticked ones as they are', () => {
    let log = start();
    const ex = log.blocks[0]!.exercises[0]!;
    log = updateActual(log, ex.sets[1]!.id, { actualReps: 12 });
    log = completeSet(log, ex.sets[0]!.id, T0);
    const out = completeAllSets(log, log.blocks[0]!.id, () => [], T1);
    const sets = out.blocks[0]!.exercises[0]!.sets;
    expect(sets.every((s) => s.completedAt !== null)).toBe(true);
    expect(sets[0]!.completedAt).toBe(T0);
    expect(sets[1]!.actualReps).toBe(12);
    // The coach's target (8-10 reps at 60 kg) is the pre-fill for an untouched set.
    expect(sets[2]!.actualReps).toBe(10);
    expect(sets[2]!.actualWeightKg).toBe(60);
    expect(out.revision).toBeGreaterThan(log.revision);
    expect(out.lastActivityAt).toBe(T1);
    // Other blocks are untouched.
    expect(out.blocks[1]).toEqual(log.blocks[1]);
  });

  it('uses last time when there is no target', () => {
    const log = start();
    const out = completeAllSets(
      log,
      log.blocks[0]!.id,
      () => [{ setType: 'drop', actualReps: 6, actualWeightKg: 40, actualDurationS: null, actualDistanceM: null }],
      T1,
    );
    expect(out.blocks[0]!.exercises[0]!.sets[4]!.actualReps).toBe(6);
  });

  it('ticks a superset’s exercises together', () => {
    const log = start();
    const out = completeAllSets(log, log.blocks[1]!.id, () => [], T1);
    expect(out.blocks[1]!.exercises.every((e) => e.sets.every((s) => s.completedAt === T1))).toBe(true);
  });

  it('only ticks the picked option of a pick-one group, and nothing before a pick', () => {
    let log = startLogFromWorkout(fixtureSectionedWorkout(), uuid, T0);
    const choice = log.blocks.find((b) => b.kind === 'choice')!;
    expect(completeAllSets(log, choice.id, () => [], T1)).toBe(log);
    log = pickChoice(log, choice.id, choice.exercises[1]!.id, T0);
    const out = completeAllSets(log, choice.id, () => [], T1);
    const block = out.blocks.find((b) => b.id === choice.id)!;
    expect(block.exercises[0]!.sets.every((s) => s.completedAt === null)).toBe(true);
    expect(block.exercises[1]!.sets.every((s) => s.completedAt === T1)).toBe(true);
  });

  it('returns the same doc when everything is already ticked or the block is unknown', () => {
    const log = start();
    expect(completeAllSets(log, 'nope', () => [], T1)).toBe(log);
    const once = completeAllSets(log, log.blocks[0]!.id, () => [], T1);
    expect(completeAllSets(once, log.blocks[0]!.id, () => [], T1)).toBe(once);
    expect(allSets(once).every((s) => s.completedAt !== null)).toBe(false); // the superset is still open
  });
});

describe('loggerKind', () => {
  it('words me, the client and another coach', () => {
    expect(loggerKind('coach', 'coach', 'client')).toBe('me');
    expect(loggerKind('client', 'coach', 'client')).toBe('client');
    expect(loggerKind(null, 'coach', 'client')).toBe('client');
    expect(loggerKind('coach-2', 'coach', 'client')).toBe('other_coach');
  });
});

describe('setLogNotes', () => {
  it('sets, clears and leaves an unchanged note alone', () => {
    const log = start();
    const noted = setLogNotes(log, 'Great depth', T1);
    expect(noted.notes).toBe('Great depth');
    expect(noted.revision).toBe(log.revision + 1);
    expect(setLogNotes(noted, 'Great depth', T1)).toBe(noted);
    expect(setLogNotes(noted, '  ', T1).notes).toBeNull();
    expect(setLogNotes(log, '', T1)).toBe(log);
  });
});
