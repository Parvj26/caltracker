import { describe, expect, it } from 'vitest';
import { AUTO_FINISH_IDLE_MS, WorkoutDoc, WorkoutLogDoc } from '@caltracker/shared';
import {
  finishPrompt,
  formatCommentTime,
  finishQuestion,
  finishedFrom,
  finishedIsLoaded,
  keepEnded,
  keepFinished,
  goneNote,
  logChange,
  rejectedNote,
  reopenFrom,
  summaryLines,
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

describe('after the server replaces the phone copy (adopt or reload)', () => {
  const W = '00000000-0000-4000-8000-000000000903';
  const done = sampleLog({ id: 'log-9', workoutId: W, status: 'completed', finishedAt: '2026-11-05T09:45:00.000Z' });
  const note = finishedFrom(done);

  it('forgets the remembered Done ✓ when that log comes back not completed (discarded elsewhere, reopened)', () => {
    expect(keepFinished(note, { ...done, status: 'discarded', finishedAt: null })).toBeNull();
    expect(keepFinished(note, { ...done, status: 'in_progress', finishedAt: null })).toBeNull();
  });

  it('keeps it for the same log still completed, for another log, or with nothing stored', () => {
    expect(keepFinished(note, done)).toBe(note);
    expect(keepFinished(note, sampleLog({ id: 'other', status: 'discarded' }))).toBe(note);
    expect(keepFinished(note, null)).toBe(note);
    expect(keepFinished(null, done)).toBeNull();
  });

  it('keeps the remembered summary log in step: the newer completed copy, or forgotten when not completed', () => {
    const corrected = { ...done, revision: 9 };
    expect(keepEnded(done, corrected)).toBe(corrected);
    expect(keepEnded(done, { ...done, status: 'discarded', finishedAt: null })).toBeNull();
    expect(keepEnded(done, sampleLog({ id: 'other' }))).toBe(done);
    expect(keepEnded(done, null)).toBe(done);
    expect(keepEnded(null, done)).toBeNull();
  });
});

describe('finishPrompt', () => {
  const twoSets = (firstDone: boolean, secondDone: boolean) => {
    const base = sampleLog();
    const ex = base.blocks[0].exercises[0];
    const set = ex.sets[0];
    const sets = [
      { ...set, completedAt: firstDone ? NOW : null },
      { ...set, id: '00000000-0000-4000-8000-000000000099', completedAt: secondDone ? NOW : null },
    ];
    return { ...base, blocks: [{ ...base.blocks[0], exercises: [{ ...ex, sets }] }] };
  };

  it('refuses with no ticked set (the shared finish rule), so the client can only discard or keep going', () => {
    expect(finishPrompt(twoSets(false, false), NOW)).toEqual({ kind: 'none-done' });
  });

  it('asks first when some sets are not ticked, and finishes straight away when all are', () => {
    expect(finishPrompt(twoSets(true, false), NOW)).toEqual({ kind: 'unticked', count: 1 });
    expect(finishPrompt(twoSets(true, true), NOW)).toEqual({ kind: 'ready' });
  });

  it('words the question with the exact copy', () => {
    expect(finishQuestion(3)).toBe('Finish with 3 sets not done? They won’t count.');
    expect(finishQuestion(1)).toBe('Finish with 1 set not done? It won’t count.');
  });
});

describe('summaryLines', () => {
  const done = sampleLog({ status: 'completed', startedAt: '2026-11-05T09:00:00.000Z', finishedAt: '2026-11-05T09:53:00.000Z' });

  it('gives duration, volume in the client units and the completed sets', () => {
    expect(summaryLines(done, 'kg')).toEqual({ duration: '53 min', volume: '480 kg lifted', sets: '1 set completed' });
    expect(summaryLines(done, 'lb').volume).toBe('1,058 lb lifted');
  });

  it('leaves the volume out when nothing weighted was lifted', () => {
    const ex = done.blocks[0].exercises[0];
    const bodyweight = { ...done, blocks: [{ ...done.blocks[0], exercises: [{ ...ex, trackingType: 'reps' as const }] }] };
    expect(summaryLines(bodyweight, 'kg').volume).toBeNull();
  });
});

describe('reopenFrom', () => {
  const done = sampleLog({ id: 'log-9', status: 'completed', autoFinished: true, finishedAt: NOW });

  it('reopens the copy on the phone when it is that log', () => {
    expect(reopenFrom({ log: done, lastSyncedRevision: 0 }, 'log-9')).toEqual({ kind: 'local' });
  });

  it('fetches the server copy when the phone has nothing, or only an uploaded finished log', () => {
    expect(reopenFrom(null, 'log-9')).toEqual({ kind: 'fetch' });
    const other = sampleLog({ id: 'other', status: 'completed', revision: 4 });
    expect(reopenFrom({ log: other, lastSyncedRevision: 4 }, 'log-9')).toEqual({ kind: 'fetch' });
  });

  it('is blocked by another workout in progress, or another finished one still uploading', () => {
    const going = sampleLog({ id: 'other', name: 'Lower B' });
    expect(reopenFrom({ log: going, lastSyncedRevision: 1 }, 'log-9')).toEqual({ kind: 'blocked', name: 'Lower B' });
    const waiting = sampleLog({ id: 'other', name: 'Lower B', status: 'completed', revision: 5 });
    expect(reopenFrom({ log: waiting, lastSyncedRevision: 4 }, 'log-9')).toEqual({ kind: 'blocked', name: 'Lower B' });
  });
});

describe('formatCommentTime', () => {
  it('reads the day and time in the phone time zone', () => {
    expect(formatCommentTime(new Date(2026, 10, 5, 10, 40).toISOString())).toBe('5 Nov · 10:40 AM');
    expect(formatCommentTime(new Date(2026, 0, 31, 23, 5).toISOString())).toBe('31 Jan · 11:05 PM');
  });
});

describe('final review fixes', () => {
  const W = '00000000-0000-4000-8000-000000000903';
  const lastTick = new Date(2026, 10, 5, 10, 40).toISOString();

  it('words the removed-client and lost-sets notes', () => {
    expect(goneNote('Iron Gym')).toBe('You’re no longer with Iron Gym, so this workout wasn’t saved.');
    expect(goneNote(null)).toBe('You’re no longer with your coach, so this workout wasn’t saved.');
    expect(rejectedNote('Upper A')).toBe(
      'Some sets from Upper A couldn’t be saved because the workout was already changed by your coach or on another device.',
    );
  });

  it('logChange: a log the sync finished automatically ends here, with its note and no timers left', () => {
    const prev = sampleLog({ name: 'Upper A' });
    const next = { ...prev, status: 'completed' as const, autoFinished: true, finishedAt: lastTick, revision: 2 };
    expect(logChange(prev, next)).toEqual({ ended: next, clearTimers: true, banner: 'We finished Upper A for you at 10:40 AM.' });
  });

  it('logChange: an adopted manual finish or discard ends with no note; a dropped log only clears the timers', () => {
    const prev = sampleLog();
    const done = { ...prev, status: 'completed' as const, finishedAt: lastTick };
    expect(logChange(prev, done)).toEqual({ ended: done, clearTimers: true, banner: null });
    const gone = { ...prev, status: 'discarded' as const };
    expect(logChange(prev, gone)).toEqual({ ended: gone, clearTimers: true, banner: null });
    expect(logChange(prev, null)).toEqual({ ended: null, clearTimers: true, banner: null });
  });

  it('logChange: nothing to do while still in progress, or when nothing was in progress', () => {
    const prev = sampleLog();
    expect(logChange(prev, { ...prev, revision: 5 })).toEqual({ ended: null, clearTimers: false, banner: null });
    const done = sampleLog({ status: 'completed', finishedAt: lastTick });
    expect(logChange(done, null)).toEqual({ ended: null, clearTimers: false, banner: null });
    expect(logChange(null, sampleLog())).toEqual({ ended: null, clearTimers: false, banner: null });
  });

  it('workoutStatuses: a finished log waiting to upload keeps its Done ✓, so it is not started twice offline', () => {
    const waiting = sampleLog({ id: 'log-p', workoutId: W, status: 'completed', finishedAt: '2026-11-05T09:40:00.000Z' });
    expect(workoutStatuses([], null, null, [waiting])[W]).toEqual({ kind: 'done', logId: 'log-p', durationS: 40 * 60 });
    // The phone's active copy still wins.
    const again = sampleLog({ id: 'log-q', workoutId: W });
    expect(workoutStatuses([], again, null, [waiting])[W]).toEqual({ kind: 'in_progress', logId: 'log-q' });
  });

  it('reopenFrom: a log still waiting in the pending list cannot be reopened yet', () => {
    const waiting = sampleLog({ id: 'log-p', name: 'Upper A', status: 'completed', autoFinished: true, finishedAt: lastTick });
    expect(reopenFrom(null, 'log-p', [{ log: waiting }])).toEqual({ kind: 'blocked', name: 'Upper A' });
    expect(reopenFrom(null, 'log-x', [{ log: waiting }])).toEqual({ kind: 'fetch' });
  });
});
