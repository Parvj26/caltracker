import { describe, expect, it } from 'vitest';
import { AUTO_FINISH_IDLE_MS, WorkoutDoc, WorkoutLogDoc } from '@caltracker/shared';
import {
  finishedFrom,
  finishedIsLoaded,
  foregroundCheck,
  formatTimeOfDay,
  parseActualInput,
  startOrResume,
  within,
  workoutStatuses,
} from './active-log-logic';
import { sampleLog } from './log-fixtures';

let n = 100;
const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const plan: WorkoutDoc = WorkoutDoc.parse({
  id: '00000000-0000-4000-8000-000000000900',
  name: 'Lower B',
  notes: null,
  blocks: [
    {
      id: makeId(),
      kind: 'straight',
      exercises: [
        {
          id: makeId(),
          exerciseId: makeId(),
          exerciseName: 'Barbell Squat',
          trackingType: 'weight_reps',
          note: null,
          sets: [
            {
              id: makeId(),
              setType: 'normal',
              targetRepsMin: 8,
              targetRepsMax: 8,
              targetWeightKg: 60,
              targetDurationS: null,
              targetDistanceM: null,
              toFailure: false,
              restSeconds: 90,
              note: null,
            },
          ],
        },
      ],
    },
  ],
});

const NOW = '2026-11-05T12:00:00.000Z';

describe('startOrResume', () => {
  it('returns the existing log when one is in progress, even for another workout', () => {
    const existing = sampleLog({ status: 'in_progress' });
    expect(startOrResume(existing, plan, makeId, NOW)).toBe(existing);
  });

  it('starts a new log from the plan when nothing is in progress, at revision 1 so it gets uploaded', () => {
    for (const existing of [null, sampleLog({ status: 'discarded' })]) {
      const log = startOrResume(existing, plan, makeId, NOW);
      expect(log).not.toBe(existing);
      expect(log.workoutId).toBe(plan.id);
      expect(log.name).toBe('Lower B');
      expect(log.status).toBe('in_progress');
      expect(log.startedAt).toBe(NOW);
      expect(log.revision).toBe(1);
      expect(WorkoutLogDoc.safeParse(log).success).toBe(true);
    }
  });

  it('starts an unplanned log from a name', () => {
    const log = startOrResume(null, 'Run', makeId, NOW);
    expect(log).toMatchObject({ name: 'Run', workoutId: null, blocks: [], revision: 1, status: 'in_progress' });
    const existing = sampleLog();
    expect(startOrResume(existing, 'Run', makeId, NOW)).toBe(existing);
  });
});

describe('foregroundCheck', () => {
  // The last tick at 10:40 local time, whatever zone the tests run in.
  const lastTick = new Date(2026, 10, 5, 10, 40).toISOString();
  const log = () => {
    const l = sampleLog({ name: 'Upper A', lastActivityAt: lastTick });
    l.blocks[0].exercises[0].sets[0].completedAt = lastTick;
    return l;
  };

  it('finishes a log idle for 3 h and words the note with the last tick time', () => {
    const result = foregroundCheck(log(), Date.parse(lastTick) + AUTO_FINISH_IDLE_MS);
    expect(result).not.toBeNull();
    expect(result!.log.status).toBe('completed');
    expect(result!.log.autoFinished).toBe(true);
    expect(result!.log.finishedAt).toBe(lastTick);
    expect(result!.banner).toBe('We finished Upper A for you at 10:40 AM.');
  });

  it('is null before 3 h, and for a log that is not in progress', () => {
    expect(foregroundCheck(log(), Date.parse(lastTick) + AUTO_FINISH_IDLE_MS - 1)).toBeNull();
    expect(foregroundCheck({ ...log(), status: 'completed', finishedAt: lastTick }, Date.parse(lastTick) + 10 * AUTO_FINISH_IDLE_MS)).toBeNull();
  });

  it('discards an idle log with no ticked set, with no note', () => {
    const empty = sampleLog({ lastActivityAt: lastTick });
    empty.blocks[0].exercises[0].sets[0].completedAt = null;
    const result = foregroundCheck(empty, Date.parse(lastTick) + AUTO_FINISH_IDLE_MS);
    expect(result!.log.status).toBe('discarded');
    expect(result!.banner).toBeNull();
  });
});

describe('formatTimeOfDay', () => {
  it('reads as a 12-hour clock in the phone zone', () => {
    expect(formatTimeOfDay(new Date(2026, 10, 5, 0, 5).toISOString())).toBe('12:05 AM');
    expect(formatTimeOfDay(new Date(2026, 10, 5, 12, 0).toISOString())).toBe('12:00 PM');
    expect(formatTimeOfDay(new Date(2026, 10, 5, 23, 59).toISOString())).toBe('11:59 PM');
  });
});

describe('parseActualInput', () => {
  it('reads whole reps, decimal weights and blanks', () => {
    expect(parseActualInput('8', 'reps')).toBe(8);
    expect(parseActualInput(' ', 'reps')).toBeNull();
    expect(parseActualInput('8.5', 'reps')).toBeUndefined();
    expect(parseActualInput('1001', 'reps')).toBeUndefined();
    expect(parseActualInput('135', 'weight')).toBe(135);
    expect(parseActualInput('61,25', 'weight')).toBe(61.25);
    expect(parseActualInput('-1', 'weight')).toBeUndefined();
    expect(parseActualInput('abc', 'weight')).toBeUndefined();
    expect(parseActualInput('1:30', 'duration')).toBe(90);
    expect(parseActualInput('1:75', 'duration')).toBeUndefined();
    expect(parseActualInput('5.2', 'distance')).toBe(5.2);
  });
});

describe('workoutStatuses', () => {
  const W1 = '00000000-0000-4000-8000-000000000901';
  const W2 = '00000000-0000-4000-8000-000000000902';
  const server = [
    {
      id: 'log-1',
      workoutId: W1,
      status: 'completed' as const,
      startedAt: '2026-11-05T09:00:00.000Z',
      finishedAt: '2026-11-05T09:52:00.000Z',
      lastActivityAt: '2026-11-05T09:52:00.000Z',
    },
  ];

  it('marks finished workouts done with their duration', () => {
    expect(workoutStatuses(server, null)).toEqual({ [W1]: { kind: 'done', logId: 'log-1', durationS: 52 * 60 } });
  });

  it('lets the phone copy win: in progress, finished but not uploaded, or discarded', () => {
    const inProgress = sampleLog({ id: 'local', workoutId: W2 });
    expect(workoutStatuses(server, inProgress)[W2]).toEqual({ kind: 'in_progress', logId: 'local' });

    const finished = sampleLog({ workoutId: W2, status: 'completed', finishedAt: '2026-11-05T09:40:00.000Z' });
    expect(workoutStatuses([], finished)[W2]).toMatchObject({ kind: 'done', durationS: 40 * 60 });

    const discarded = sampleLog({ workoutId: W1, status: 'discarded' });
    expect(workoutStatuses(server, discarded)[W1]).toBeUndefined();
  });
});

describe('within', () => {
  it('gives the value, or null on failure or after the time limit', async () => {
    expect(await within(Promise.resolve(3), 50)).toBe(3);
    expect(await within(Promise.reject(new Error('no signal')), 50)).toBeNull();
    expect(await within(new Promise(() => undefined), 10)).toBeNull();
  });
});

describe('recently finished workout (Done ✓ survives the upload)', () => {
  const W = '00000000-0000-4000-8000-000000000903';
  const finishedLog = sampleLog({
    id: 'log-9',
    workoutId: W,
    status: 'completed',
    startedAt: '2026-11-05T09:00:00.000Z',
    finishedAt: '2026-11-05T09:45:00.000Z',
  });

  it('finishedFrom keeps a finished planned log, and nothing else', () => {
    expect(finishedFrom(finishedLog)).toEqual({ logId: 'log-9', workoutId: W, durationS: 45 * 60 });
    expect(finishedFrom(sampleLog({ workoutId: W }))).toBeNull(); // in progress
    expect(finishedFrom(sampleLog({ workoutId: null, status: 'completed', finishedAt: finishedLog.finishedAt }))).toBeNull();
    expect(finishedFrom(sampleLog({ workoutId: W, status: 'discarded' }))).toBeNull();
    expect(finishedFrom(null)).toBeNull();
  });

  it('shows Done ✓ after the store is cleared and before the server list has the log', () => {
    const finished = finishedFrom(finishedLog);
    expect(workoutStatuses([], null, finished)[W]).toEqual({ kind: 'done', logId: 'log-9', durationS: 45 * 60 });
  });

  it('lets an in-progress phone log of the same workout win over the remembered one', () => {
    const again = sampleLog({ id: 'log-10', workoutId: W });
    expect(workoutStatuses([], again, finishedFrom(finishedLog))[W]).toEqual({ kind: 'in_progress', logId: 'log-10' });
  });

  it('finishedIsLoaded once the server list contains that log', () => {
    const finished = finishedFrom(finishedLog);
    expect(finishedIsLoaded(finished, [])).toBe(false);
    expect(finishedIsLoaded(finished, [{ id: 'other' }])).toBe(false);
    expect(finishedIsLoaded(finished, [{ id: 'log-9' }])).toBe(true);
    expect(finishedIsLoaded(null, [{ id: 'log-9' }])).toBe(false);
  });
});
