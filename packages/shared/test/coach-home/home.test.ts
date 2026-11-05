import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  endingPrograms,
  missedClients,
  quietClients,
  todayRows,
  weekProgress,
  workoutStatus,
} from '../../src/coach-home/home';
import type { HomeAssignment, HomeClient, HomeLog, HomeWorkout } from '../../src/coach-home/home';

let n = 0;
function log(p: Partial<HomeLog> = {}): HomeLog {
  n += 1;
  return {
    id: `log${n}`,
    status: 'completed',
    startedAt: '2026-11-05T10:00:00Z',
    finishedAt: '2026-11-05T10:30:00Z',
    lastActivityAt: '2026-11-05T10:30:00Z',
    ...p,
  };
}
function wk(p: Partial<HomeWorkout> = {}): HomeWorkout {
  n += 1;
  return { id: `w${n}`, clientId: 'c1', name: 'Workout', scheduledOn: '2026-11-05', logs: [], ...p };
}
function client(p: Partial<HomeClient> = {}): HomeClient {
  return { id: 'c1', firstName: 'Sam', lastName: 'Lee', joinedOn: '2026-01-01', lastFinishedOn: null, ...p };
}
function asg(p: Partial<HomeAssignment> = {}): HomeAssignment {
  n += 1;
  return { id: `a${n}`, clientId: 'c1', startDate: '2026-10-01', endDate: '2026-11-05', cancelledOn: null, ...p };
}

const TODAY = '2026-11-05';

afterEach(() => vi.useRealTimers());

describe('workoutStatus', () => {
  it('is not started with no logs', () => {
    expect(workoutStatus(wk())).toEqual({ kind: 'not_started' });
  });
  it('ignores discarded logs', () => {
    expect(workoutStatus(wk({ logs: [log({ status: 'discarded' })] }))).toEqual({ kind: 'not_started' });
  });
  it('is training with an in-progress log', () => {
    const l = log({ status: 'in_progress', finishedAt: null });
    expect(workoutStatus(wk({ logs: [l] }))).toEqual({ kind: 'training', logId: l.id });
  });
  it('is done with the completed log', () => {
    const c = log();
    expect(workoutStatus(wk({ logs: [log({ status: 'discarded' }), c] }))).toMatchObject({
      kind: 'done',
      logId: c.id,
    });
  });
  it('picks the newest completed log', () => {
    const older = log({ finishedAt: '2026-11-05T09:00:00Z' });
    const newer = log({ finishedAt: '2026-11-05T11:00:00Z' });
    expect(workoutStatus(wk({ logs: [newer, older] }))).toMatchObject({ kind: 'done', logId: newer.id });
    expect(workoutStatus(wk({ logs: [older, newer] }))).toMatchObject({ kind: 'done', logId: newer.id });
  });
  it('reports the duration of that log', () => {
    const l = log({ startedAt: '2026-11-05T10:00:00Z', finishedAt: '2026-11-05T10:52:00Z' });
    expect(workoutStatus(wk({ logs: [l] }))).toEqual({ kind: 'done', logId: l.id, durationS: 3120 });
  });
  it('prefers done over training', () => {
    const c = log();
    const t = log({ status: 'in_progress', finishedAt: null });
    expect(workoutStatus(wk({ logs: [t, c] })).kind).toBe('done');
  });
});

describe('todayRows', () => {
  it('keeps only workouts scheduled today', () => {
    const a = wk({ scheduledOn: TODAY });
    const rows = todayRows([a, wk({ scheduledOn: '2026-11-04' }), wk({ scheduledOn: '2026-11-06' })], [client()], TODAY);
    expect(rows.map((r) => r.workout.id)).toEqual([a.id]);
  });
  it('drops workouts of clients not in the list', () => {
    expect(todayRows([wk({ clientId: 'gone' })], [client()], TODAY)).toEqual([]);
  });
  it('sorts by last name, then workout name', () => {
    const clients = [client({ id: 'a', lastName: 'Zed' }), client({ id: 'b', lastName: 'Adams' })];
    const ws = [
      wk({ clientId: 'a', name: 'Legs' }),
      wk({ clientId: 'b', name: 'Push' }),
      wk({ clientId: 'b', name: 'Pull' }),
    ];
    expect(todayRows(ws, clients, TODAY).map((r) => `${r.client.id}:${r.workout.name}`)).toEqual([
      'b:Pull',
      'b:Push',
      'a:Legs',
    ]);
  });
  it('ignores the real clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-06T03:00:00Z');
    expect(todayRows([wk({ scheduledOn: '2026-11-05' })], [client()], '2026-11-05')).toHaveLength(1);
  });
});

describe('weekProgress', () => {
  it('covers Monday to Sunday of the week only', () => {
    const ws = ['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09'].map((d) => wk({ scheduledOn: d }));
    expect(weekProgress(ws, TODAY)).toEqual({ done: 0, planned: 2 });
  });
  it('counts done workouts', () => {
    const ws = [wk({ logs: [log()] }), wk({ logs: [log({ status: 'discarded' })] }), wk()];
    expect(weekProgress(ws, TODAY)).toEqual({ done: 1, planned: 3 });
  });
  it('is zero with nothing planned', () => {
    expect(weekProgress([], TODAY)).toEqual({ done: 0, planned: 0 });
  });
});

describe('missedClients', () => {
  it('reports clients with two or more missed workouts', () => {
    const ws = [wk({ scheduledOn: '2026-11-01' }), wk({ scheduledOn: '2026-11-04' })];
    expect(missedClients(ws, TODAY)).toEqual([{ clientId: 'c1', missed: 2 }]);
  });
  it('ignores a single miss', () => {
    expect(missedClients([wk({ scheduledOn: '2026-11-04' })], TODAY)).toEqual([]);
  });
  it('ignores today and eight days ago', () => {
    const ws = [wk({ scheduledOn: '2026-11-05' }), wk({ scheduledOn: '2026-10-28' }), wk({ scheduledOn: '2026-11-04' })];
    expect(missedClients(ws, TODAY)).toEqual([]);
  });
  it('does not count done workouts', () => {
    const ws = [wk({ scheduledOn: '2026-11-01', logs: [log()] }), wk({ scheduledOn: '2026-11-04' })];
    expect(missedClients(ws, TODAY)).toEqual([]);
  });
  it('sorts by missed descending, then client id', () => {
    const m = (clientId: string, k: number) =>
      Array.from({ length: k }, () => wk({ clientId, scheduledOn: '2026-11-03' }));
    expect(missedClients([...m('b', 2), ...m('a', 2), ...m('c', 3)], TODAY)).toEqual([
      { clientId: 'c', missed: 3 },
      { clientId: 'a', missed: 2 },
      { clientId: 'b', missed: 2 },
    ]);
  });
});

describe('quietClients', () => {
  const none = new Set<string>();
  it('skips clients who joined under 5 days ago', () => {
    expect(quietClients([client({ joinedOn: '2026-11-03' })], TODAY, none)).toEqual([]);
  });
  it('reports days since last finished', () => {
    const c = client({ joinedOn: '2026-10-01', lastFinishedOn: '2026-10-30' });
    expect(quietClients([c], TODAY, none)).toEqual([{ clientId: 'c1', days: 6 }]);
  });
  it('skips 4 days', () => {
    expect(quietClients([client({ lastFinishedOn: '2026-11-01' })], TODAY, none)).toEqual([]);
  });
  it('reports 30+ for a long-time never-logged client', () => {
    expect(quietClients([client({ joinedOn: '2026-09-01' })], TODAY, none)).toEqual([
      { clientId: 'c1', days: '30+' },
    ]);
  });
  it('uses days since joining when never logged and joined recently', () => {
    expect(quietClients([client({ joinedOn: '2026-10-20' })], TODAY, none)).toEqual([{ clientId: 'c1', days: 16 }]);
  });
  it('reports 30+ for a last finish 30 or more days ago', () => {
    expect(quietClients([client({ lastFinishedOn: '2026-10-06' })], TODAY, none)).toEqual([
      { clientId: 'c1', days: '30+' },
    ]);
  });
  it('skips excluded clients', () => {
    expect(quietClients([client({ joinedOn: '2026-09-01' })], TODAY, new Set(['c1']))).toEqual([]);
  });
  it('sorts 30+ first, then most days', () => {
    const cs = [
      client({ id: 'a', joinedOn: '2026-10-01', lastFinishedOn: '2026-10-30' }),
      client({ id: 'b', joinedOn: '2026-09-01' }),
      client({ id: 'c', joinedOn: '2026-10-01', lastFinishedOn: '2026-10-24' }),
    ];
    expect(quietClients(cs, TODAY, none).map((q) => q.days)).toEqual(['30+', 12, 6]);
  });
});

describe('endingPrograms', () => {
  it('includes an assignment ending today', () => {
    expect(endingPrograms([asg({ endDate: TODAY })], TODAY)).toMatchObject([{ clientId: 'c1', daysLeft: 0 }]);
  });
  it('includes today+7 only', () => {
    const a7 = asg({ endDate: '2026-11-12' });
    const out = endingPrograms([a7, asg({ endDate: '2026-11-13' }), asg({ endDate: '2026-11-04' })], TODAY);
    expect(out).toEqual([{ clientId: 'c1', assignmentId: a7.id, daysLeft: 7 }]);
  });
  it('excludes cancelled assignments', () => {
    expect(endingPrograms([asg({ cancelledOn: '2026-11-01' })], TODAY)).toEqual([]);
  });
  it('excludes when a follow-up assignment starts later', () => {
    const ending = asg({ endDate: '2026-11-10' });
    const next = asg({ startDate: '2026-11-11', endDate: '2026-12-10' });
    expect(endingPrograms([ending, next], TODAY)).toEqual([]);
  });
  it('sorts by days left', () => {
    const a = asg({ clientId: 'a', endDate: '2026-11-09' });
    const b = asg({ clientId: 'b', endDate: '2026-11-06' });
    expect(endingPrograms([a, b], TODAY).map((e) => e.clientId)).toEqual(['b', 'a']);
  });
});
