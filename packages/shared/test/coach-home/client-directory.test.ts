import { describe, expect, it } from 'vitest';
import {
  compareDirectoryRows,
  directoryChip,
  directoryCounts,
  directoryRows,
  fourWeekCompletion,
  invitedLabel,
  invitedShortLabel,
  matchesDirectoryFilter,
} from '../../src/coach-home/client-directory';
import type { DirectoryClient, DirectoryInput, DirectoryRow, DirectoryWorkout } from '../../src/coach-home/client-directory';
import type { CheckAssignment } from '../../src/coach-home/daily-check';
import type { HomeLog } from '../../src/coach-home/home';

// Thursday 5 November 2026. The week runs Monday 2 to Sunday 8 November.
const TODAY = '2026-11-05';

let n = 0;
function log(p: Partial<HomeLog> = {}): HomeLog {
  n += 1;
  return { id: `log${n}`, status: 'completed', startedAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T10:30:00Z', lastActivityAt: '2026-11-01T10:30:00Z', ...p };
}
const done = () => [log()];
function wk(scheduledOn: string, p: Partial<DirectoryWorkout> = {}): DirectoryWorkout {
  n += 1;
  return { id: `w${n}`, clientId: 'c1', name: 'Workout', scheduledOn, logs: [], assignmentId: 'a-prog', ...p };
}
function client(p: Partial<DirectoryClient> = {}): DirectoryClient {
  return { id: 'c1', firstName: 'Sam', lastName: 'Lee', joinedOn: '2026-09-01', lastFinishedOn: '2026-11-03', lastWorkoutName: 'Push', ...p };
}
function asg(p: Partial<CheckAssignment> = {}): CheckAssignment {
  n += 1;
  return { id: `a${n}`, clientId: 'c1', startDate: '2026-10-01', endDate: '2026-11-29', cancelledOn: null, programName: 'Strength 8', ...p };
}
function input(p: Partial<DirectoryInput> = {}): DirectoryInput {
  return { clients: [client()], workouts: [], assignments: [], today: TODAY, timeZone: 'Europe/London', ...p };
}
const only = (p: Partial<DirectoryInput>) => directoryRows(input(p))[0]!;
/** Something planned tomorrow keeps "nothing planned" out of tests about other things. */
const tomorrow = () => wk('2026-11-06');

describe('status', () => {
  it('is Active when on track', () => {
    const r = only({ workouts: [wk('2026-11-03', { logs: done() }), tomorrow()], assignments: [asg()] });
    expect(r.status).toEqual({ kind: 'active' });
    expect(r.flags).toEqual({ missed: false, planEnding: false, nothingPlanned: false });
  });

  it('is Training now while a log is in progress, ahead of anything else', () => {
    const r = only({ workouts: [wk('2026-11-03'), wk(TODAY, { logs: [log({ status: 'in_progress', finishedAt: null })] })] });
    expect(r.status).toEqual({ kind: 'training' });
    expect(r.flags.missed).toBe(true);
  });

  it('ignores a training log on a future workout', () => {
    const r = only({ workouts: [wk('2026-11-06', { logs: [log({ status: 'in_progress', finishedAt: null })] })], assignments: [asg()] });
    expect(r.status.kind).toBe('active');
  });

  it('counts misses this week only (Monday to yesterday), not last week or today', () => {
    const r = only({ workouts: [wk('2026-10-30'), wk('2026-11-02'), wk('2026-11-04'), wk(TODAY), tomorrow()] });
    expect(r.status).toEqual({ kind: 'missed', count: 2 });
    expect(r.week).toEqual({ done: 0, planned: 4, missed: 2 });
  });

  it('does not count misses from before the client joined', () => {
    const r = only({ clients: [client({ joinedOn: '2026-11-04' })], workouts: [wk('2026-11-02'), tomorrow()] });
    expect(r.flags.missed).toBe(false);
  });

  it('is Plan ends when the program ends within 7 days with nothing after', () => {
    const r = only({ workouts: [tomorrow()], assignments: [asg({ endDate: '2026-11-06' })] });
    expect(r.status).toEqual({ kind: 'plan_ending', endDate: '2026-11-06' });
    expect(r.plan).toEqual({ kind: 'program', name: 'Strength 8', endDate: '2026-11-06', endingSoon: true });
  });

  it('is not ending when another program follows', () => {
    const r = only({
      workouts: [tomorrow()],
      assignments: [asg({ endDate: '2026-11-06' }), asg({ startDate: '2026-11-09', endDate: '2026-12-06', programName: 'Next' })],
    });
    expect(r.status.kind).toBe('active');
    expect(r.plan).toMatchObject({ kind: 'program', name: 'Strength 8', endingSoon: false });
  });

  it('is Nothing planned with nothing today or in the next 7 days', () => {
    const r = only({ workouts: [wk('2026-11-03', { logs: done() })] });
    expect(r.status).toEqual({ kind: 'nothing_planned' });
    expect(r.plan).toBeNull();
  });
});

describe('plan', () => {
  it('shows the next single workout when there is no program', () => {
    const r = only({
      workouts: [
        wk('2026-11-03', { assignmentId: null, name: 'Old' }),
        wk(TODAY, { assignmentId: null, name: 'Done today', logs: done() }),
        wk('2026-11-20', { assignmentId: null, name: 'Later' }),
        wk('2026-11-12', { assignmentId: null, name: 'Full Body A' }),
      ],
    });
    expect(r.plan).toEqual({ kind: 'single', name: 'Full Body A', on: '2026-11-12' });
    expect(r.flags.nothingPlanned).toBe(false);
  });

  it('prefers the program over single workouts', () => {
    const r = only({ workouts: [wk('2026-11-06', { assignmentId: null })], assignments: [asg()] });
    expect(r.plan?.kind).toBe('program');
  });
});

describe('last workout and four weeks', () => {
  it('carries the last workout day and name', () => {
    expect(only({ workouts: [tomorrow()] }).lastWorkout).toEqual({ on: '2026-11-03', name: 'Push' });
    expect(only({ clients: [client({ lastFinishedOn: null, lastWorkoutName: null })] }).lastWorkout).toBeNull();
  });

  it('counts the 28 days before today, plus today once done', () => {
    const ws = [
      wk('2026-10-07', { logs: done() }), // 29 days back: outside
      wk('2026-10-08', { logs: done() }),
      wk('2026-10-20'),
      wk('2026-11-04', { logs: done() }),
      wk(TODAY), // not done yet: not due
      wk('2026-11-06'), // future
    ];
    expect(fourWeekCompletion(ws, TODAY, '2026-09-01')).toEqual({ done: 2, due: 3, percent: 67 });
    expect(fourWeekCompletion([...ws, wk(TODAY, { logs: done() })], TODAY, '2026-09-01')).toEqual({ done: 3, due: 4, percent: 75 });
  });

  it('skips days before joining and has no percent when nothing was due', () => {
    expect(fourWeekCompletion([wk('2026-10-20')], TODAY, '2026-11-01')).toEqual({ done: 0, due: 0, percent: null });
  });

  it('ignores discarded logs', () => {
    expect(fourWeekCompletion([wk('2026-11-04', { logs: [log({ status: 'discarded' })] })], TODAY, '2026-09-01').percent).toBe(0);
  });
});

describe('filters, counts and sort', () => {
  const rows = directoryRows(
    input({
      clients: [
        client({ id: 'a', firstName: 'Ann', lastName: 'Adams', lastFinishedOn: '2026-11-01' }),
        client({ id: 'b', firstName: 'Bo', lastName: 'Brown', lastFinishedOn: null, lastWorkoutName: null }),
        client({ id: 'c', firstName: 'Cy', lastName: 'Cole', lastFinishedOn: '2026-11-04' }),
      ],
      workouts: [
        wk('2026-11-03', { clientId: 'a' }),
        wk('2026-11-06', { clientId: 'a' }),
        wk('2026-11-04', { clientId: 'c', logs: done() }),
        wk('2026-11-06', { clientId: 'c' }),
      ],
      assignments: [asg({ clientId: 'a', endDate: '2026-12-20' }), asg({ clientId: 'c', endDate: '2026-11-07' })],
    }),
  );
  const ids = (list: DirectoryRow[]) => list.map((r) => r.clientId);

  it('filters by flag', () => {
    expect(ids(rows.filter((r) => matchesDirectoryFilter(r, 'missed')))).toEqual(['a']);
    expect(ids(rows.filter((r) => matchesDirectoryFilter(r, 'plan_ending')))).toEqual(['c']);
    expect(ids(rows.filter((r) => matchesDirectoryFilter(r, 'nothing_planned')))).toEqual(['b']);
    expect(rows.filter((r) => matchesDirectoryFilter(r, 'invited'))).toEqual([]);
    expect(rows.every((r) => matchesDirectoryFilter(r, 'active'))).toBe(true);
  });

  it('counts each chip', () => {
    expect(directoryCounts(rows)).toEqual({ active: 3, missed: 1, plan_ending: 1, nothing_planned: 1 });
  });

  it('sorts by last workout, name, completion and plan end', () => {
    const sorted = (s: Parameters<typeof compareDirectoryRows>[0]) => ids([...rows].sort(compareDirectoryRows(s)));
    expect(sorted('last_workout')).toEqual(['c', 'a', 'b']);
    expect(sorted('name')).toEqual(['a', 'b', 'c']);
    expect(sorted('completion')).toEqual(['a', 'c', 'b']); // 0%, 100%, nothing due last
    expect(sorted('plan_end')).toEqual(['c', 'a', 'b']);
  });
});

describe('invitedLabel', () => {
  it('says when the invite went out', () => {
    expect(invitedLabel(TODAY, TODAY)).toBe('Invited today');
    expect(invitedLabel('2026-11-04', TODAY)).toBe('Invited yesterday');
    expect(invitedLabel('2026-11-03', TODAY)).toBe('Invited 2 days ago');
  });
});

describe('directoryChip (the one chip on a phone row)', () => {
  it('is Missed N when any workout was missed this week, even while training or with nothing planned', () => {
    expect(directoryChip(only({ workouts: [wk('2026-11-02'), wk('2026-11-04'), tomorrow()] }))).toEqual({ kind: 'missed', count: 2 });
    const training = only({ workouts: [wk('2026-11-03'), wk(TODAY, { logs: [log({ status: 'in_progress', finishedAt: null })] })] });
    expect(directoryChip(training)).toEqual({ kind: 'missed', count: 1 });
    expect(directoryChip(only({ workouts: [wk('2026-11-03')] }))).toEqual({ kind: 'missed', count: 1 });
  });

  it('is Nothing planned with nothing coming up and nothing missed', () => {
    expect(directoryChip(only({ workouts: [wk('2026-11-03', { logs: done() })] }))).toEqual({ kind: 'nothing_planned' });
  });

  it('is On track otherwise: active, training with nothing missed, or a plan ending', () => {
    expect(directoryChip(only({ workouts: [wk('2026-11-03', { logs: done() }), tomorrow()], assignments: [asg()] }))).toEqual({ kind: 'on_track' });
    const training = only({ workouts: [wk(TODAY, { logs: [log({ status: 'in_progress', finishedAt: null })] }), tomorrow()] });
    expect(directoryChip(training)).toEqual({ kind: 'on_track' });
    expect(directoryChip(only({ workouts: [tomorrow()], assignments: [asg({ endDate: '2026-11-06' })] }))).toEqual({ kind: 'on_track' });
  });
});

describe('invitedShortLabel', () => {
  it('says how long ago in days, then weeks', () => {
    expect(invitedShortLabel(TODAY, TODAY)).toBe('Invited today');
    expect(invitedShortLabel('2026-11-04', TODAY)).toBe('Invited 1 d');
    expect(invitedShortLabel('2026-10-30', TODAY)).toBe('Invited 6 d');
    expect(invitedShortLabel('2026-10-29', TODAY)).toBe('Invited 1 wk');
    expect(invitedShortLabel('2026-10-23', TODAY)).toBe('Invited 1 wk');
    expect(invitedShortLabel('2026-10-22', TODAY)).toBe('Invited 2 wk');
  });

  it('never goes negative', () => {
    expect(invitedShortLabel('2026-11-06', TODAY)).toBe('Invited today');
  });
});
