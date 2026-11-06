import { describe, expect, it } from 'vitest';
import {
  attentionGroups,
  checkClient,
  checkClients,
  compareClientChecks,
  lastWorkoutLabel,
} from '../../src/coach-home/daily-check';
import type { CheckAssignment, ClientCheck, DailyCheckInput } from '../../src/coach-home/daily-check';
import type { HomeClient, HomeLog, HomeWorkout } from '../../src/coach-home/home';
import type { PrEvent } from '../../src/awards/week-prs';

// Thursday 5 November 2026. The week runs Monday 2 to Sunday 8 November.
const TODAY = '2026-11-05';
const TZ = 'Europe/London';

let n = 0;
function log(p: Partial<HomeLog> = {}): HomeLog {
  n += 1;
  return { id: `log${n}`, status: 'completed', startedAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T10:30:00Z', lastActivityAt: '2026-11-01T10:30:00Z', ...p };
}
const done = () => [log()];
function wk(scheduledOn: string, p: Partial<HomeWorkout> = {}): HomeWorkout {
  n += 1;
  return { id: `w${n}`, clientId: 'c1', name: 'Workout', scheduledOn, logs: [], ...p };
}
function client(p: Partial<HomeClient> = {}): HomeClient {
  return { id: 'c1', firstName: 'Sam', lastName: 'Lee', joinedOn: '2026-09-01', lastFinishedOn: '2026-11-03', ...p };
}
function asg(p: Partial<CheckAssignment> = {}): CheckAssignment {
  n += 1;
  return { id: `a${n}`, clientId: 'c1', startDate: '2026-10-01', endDate: '2026-11-29', cancelledOn: null, programName: 'Strength 8', ...p };
}
function input(p: Partial<DailyCheckInput> = {}): DailyCheckInput {
  return { clients: [client()], workouts: [], assignments: [], prs: [], today: TODAY, timeZone: TZ, ...p };
}
/** Something on the plan tomorrow, so "nothing planned" stays out of tests about other reasons. */
const tomorrow = () => wk('2026-11-06');
const kinds = (c: ClientCheck) => c.reasons.map((r) => r.kind);
const only = (p: Partial<DailyCheckInput>) => checkClients(input(p))[0]!;

describe('missed workouts', () => {
  it('flags a single missed workout in the last 7 days with its count and day', () => {
    const c = only({ workouts: [wk('2026-11-03'), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed', count: 1, lastMissedOn: '2026-11-03' }]);
    expect(c.status).toBe('needs_attention');
  });

  it('counts every miss in the window and reports the latest', () => {
    const c = only({ workouts: [wk('2026-10-30'), wk('2026-11-01', { logs: done() }), wk('2026-11-03'), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed', count: 2, lastMissedOn: '2026-11-03' }]);
  });

  it('does not call a workout planned for today missed while today is still going', () => {
    const c = only({ workouts: [wk(TODAY), tomorrow()] });
    expect(kinds(c)).toEqual([]);
    expect(c.status).toBe('on_track');
  });

  it('calls yesterday missed once the day is over', () => {
    expect(kinds(only({ workouts: [wk('2026-11-04'), tomorrow()] }))).toEqual(['missed']);
  });

  it('uses the coach\'s today, not UTC: 23:30 on the 4th in Los Angeles is already the 5th in UTC', () => {
    // The caller passes the coach's own date. On the 4th the workout of the 4th is not missed yet.
    const workouts = [wk('2026-11-04'), wk('2026-11-05')];
    expect(kinds(checkClients(input({ workouts, today: '2026-11-04', timeZone: 'America/Los_Angeles' }))[0]!)).toEqual([]);
    expect(kinds(checkClients(input({ workouts, today: '2026-11-05', timeZone: 'America/Los_Angeles' }))[0]!)).toEqual(['missed']);
  });

  it('treats a discarded log as not done', () => {
    expect(kinds(only({ workouts: [wk('2026-11-03', { logs: [log({ status: 'discarded' })] }), tomorrow()] }))).toEqual(['missed']);
  });

  it('treats a log still in progress as not done', () => {
    expect(kinds(only({ workouts: [wk('2026-11-03', { logs: [log({ status: 'in_progress', finishedAt: null })] }), tomorrow()] }))).toEqual(['missed']);
  });

  it('counts a completed log as done even next to a discarded one', () => {
    expect(kinds(only({ workouts: [wk('2026-11-03', { logs: [log({ status: 'discarded' }), log()] }), tomorrow()] }))).toEqual([]);
  });

  it('ignores misses older than 7 days', () => {
    expect(kinds(only({ workouts: [wk('2026-10-28'), tomorrow()] }))).toEqual([]);
  });

  it('includes the miss exactly 7 days ago', () => {
    expect(only({ workouts: [wk('2026-10-29'), tomorrow()] }).reasons).toEqual([{ kind: 'missed', count: 1, lastMissedOn: '2026-10-29' }]);
  });
});

describe('missed 2+ in a row', () => {
  it('flags the last two planned workouts both missed', () => {
    const c = only({ workouts: [wk('2026-11-01', { logs: done() }), wk('2026-11-02'), wk('2026-11-04'), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed_in_a_row', count: 2, lastMissedOn: '2026-11-04' }]);
    expect(c.status).toBe('needs_attention');
  });

  it('is plain "missed" when a done workout sits between the misses', () => {
    const c = only({ workouts: [wk('2026-11-01'), wk('2026-11-02', { logs: done() }), wk('2026-11-04'), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed', count: 2, lastMissedOn: '2026-11-04' }]);
  });

  it('is plain "missed" when the latest past workout was done', () => {
    const c = only({ workouts: [wk('2026-11-01'), wk('2026-11-02'), wk('2026-11-04', { logs: done() }), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed', count: 2, lastMissedOn: '2026-11-02' }]);
  });

  it('counts the run back past the 7-day window (up to 14 days) when the latest miss is recent', () => {
    const c = only({ workouts: [wk('2026-10-25'), wk('2026-10-27'), wk('2026-11-03'), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed_in_a_row', count: 3, lastMissedOn: '2026-11-03' }]);
  });

  it('does not flag a run that ended more than 7 days ago', () => {
    expect(kinds(only({ workouts: [wk('2026-10-25'), wk('2026-10-27'), tomorrow()] }))).toEqual([]);
  });

  it('does not let today\'s not-yet-done workout break or extend the run', () => {
    const c = only({ workouts: [wk('2026-11-03'), wk('2026-11-04'), wk(TODAY), tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'missed_in_a_row', count: 2, lastMissedOn: '2026-11-04' }]);
  });

  it('counts two missed workouts on the same day as two in a row', () => {
    expect(kinds(only({ workouts: [wk('2026-11-04'), wk('2026-11-04'), tomorrow()] }))).toEqual(['missed_in_a_row']);
  });
});

describe('program ending', () => {
  it('flags a program ending within 7 days', () => {
    const a = asg({ endDate: '2026-11-08' });
    const c = only({ assignments: [a], workouts: [tomorrow()] });
    expect(c.reasons).toEqual([{ kind: 'program_ending', assignmentId: a.id, endDate: '2026-11-08', daysLeft: 3 }]);
    expect(c.status).toBe('program_ending');
  });

  it('includes a program ending today and one ending in exactly 7 days', () => {
    expect(kinds(only({ assignments: [asg({ endDate: TODAY })], workouts: [tomorrow()] }))).toEqual(['program_ending']);
    expect(kinds(only({ assignments: [asg({ endDate: '2026-11-12' })], workouts: [tomorrow()] }))).toEqual(['program_ending']);
  });

  it('ignores a program ending in 8 days, a cancelled one, and one followed by another program', () => {
    expect(kinds(only({ assignments: [asg({ endDate: '2026-11-13' })], workouts: [tomorrow()] }))).toEqual([]);
    expect(kinds(only({ assignments: [asg({ endDate: '2026-11-08', cancelledOn: '2026-11-01' })], workouts: [tomorrow()] }))).toEqual([]);
    const next = asg({ startDate: '2026-11-09', endDate: '2026-12-06' });
    expect(kinds(only({ assignments: [asg({ endDate: '2026-11-08' }), next], workouts: [tomorrow()] }))).toEqual([]);
  });

  it('replaces "nothing planned" when both are true, so the client is listed once with Assign', () => {
    expect(kinds(only({ assignments: [asg({ endDate: TODAY })] }))).toEqual(['program_ending']);
  });
});

describe('nothing planned', () => {
  it('flags a client with no plan at all', () => {
    const c = only({});
    expect(c.reasons).toEqual([{ kind: 'nothing_planned' }]);
    expect(c.status).toBe('nothing_planned');
  });

  it('counts a workout up to 7 days ahead as planned, but not one 8 days ahead', () => {
    expect(kinds(only({ workouts: [wk('2026-11-12')] }))).toEqual([]);
    expect(kinds(only({ workouts: [wk('2026-11-13')] }))).toEqual(['nothing_planned']);
  });

  it('counts today\'s workout as planned until it is done', () => {
    expect(kinds(only({ workouts: [wk(TODAY)] }))).toEqual([]);
    expect(kinds(only({ workouts: [wk(TODAY, { logs: done() })] }))).toEqual(['nothing_planned']);
  });

  it('flags a client who joined today too: they need a first plan', () => {
    expect(kinds(only({ clients: [client({ joinedOn: TODAY })] }))).toEqual(['nothing_planned']);
  });
});

describe('no workout in 5+ days', () => {
  // Tomorrow is planned and nothing was missed, so only the quiet rule can fire.
  const quiet = (p: Partial<HomeClient>, lookbackDays?: number) =>
    only({ clients: [client(p)], workouts: [tomorrow()], ...(lookbackDays ? { lookbackDays } : {}) });

  it('flags a client whose last workout was 5 or more days ago', () => {
    expect(quiet({ lastFinishedOn: '2026-10-31' }).reasons).toEqual([{ kind: 'quiet', days: 5, atLeast: false }]);
    expect(quiet({ lastFinishedOn: '2026-10-31' }).status).toBe('needs_attention');
    expect(kinds(quiet({ lastFinishedOn: '2026-11-01' }))).toEqual([]);
  });

  it('counts from the join date for a client who never trained, and waits 5 days after joining', () => {
    expect(quiet({ joinedOn: '2026-10-29', lastFinishedOn: null }).reasons).toEqual([{ kind: 'quiet', days: 7, atLeast: false }]);
    expect(kinds(quiet({ joinedOn: '2026-11-01', lastFinishedOn: null }))).toEqual([]);
  });

  it('says "at least" when the last workout is older than the data the page loaded', () => {
    expect(quiet({ joinedOn: '2026-01-01', lastFinishedOn: null }).reasons).toEqual([{ kind: 'quiet', days: 30, atLeast: true }]);
    expect(quiet({ joinedOn: '2026-01-01', lastFinishedOn: null }, 90).reasons).toEqual([{ kind: 'quiet', days: 90, atLeast: true }]);
  });

  it('is left out when a missed workout or "nothing planned" already explains it', () => {
    expect(kinds(only({ clients: [client({ lastFinishedOn: '2026-10-20' })], workouts: [wk('2026-11-03'), tomorrow()] }))).toEqual(['missed']);
    expect(kinds(only({ clients: [client({ lastFinishedOn: '2026-10-20' })] }))).toEqual(['nothing_planned']);
  });
});

describe('new personal bests', () => {
  const pr = (p: Partial<PrEvent> = {}): PrEvent => ({ clientId: 'c1', logId: 'l1', exerciseId: 'squat', achievedAt: '2026-11-03T18:00:00Z', ...p });

  it('celebrates lifts improved this week, counting a lift once per workout', () => {
    const c = only({ workouts: [tomorrow()], prs: [pr(), pr(), pr({ exerciseId: 'bench' }), pr({ logId: 'l2' })] });
    expect(c.reasons).toEqual([{ kind: 'new_bests', count: 3 }]);
    expect(c.status).toBe('on_track');
  });

  it('reads the day in the coach\'s time zone: Sunday 23:30 in London is last week, Monday 00:30 is this week', () => {
    expect(kinds(only({ workouts: [tomorrow()], prs: [pr({ achievedAt: '2026-11-01T23:30:00Z' })] }))).toEqual([]);
    expect(kinds(only({ workouts: [tomorrow()], prs: [pr({ achievedAt: '2026-11-02T00:30:00Z' })] }))).toEqual(['new_bests']);
  });

  it('lists the celebration after the problems', () => {
    expect(kinds(only({ workouts: [wk('2026-11-03')], prs: [pr()] }))).toEqual(['missed', 'nothing_planned', 'new_bests']);
  });
});

describe('status, week and program for the clients list', () => {
  it('ranks needs attention above program ending above nothing planned', () => {
    expect(only({ workouts: [wk('2026-11-03')], assignments: [asg({ endDate: TODAY })] }).status).toBe('needs_attention');
  });

  it('counts this week Monday to Sunday: done of planned', () => {
    const c = only({ workouts: [wk('2026-11-01', { logs: done() }), wk('2026-11-02', { logs: done() }), wk('2026-11-04'), wk('2026-11-07'), wk('2026-11-09')] });
    expect(c.week).toEqual({ done: 1, planned: 3 });
  });

  it('shows the program running today, or else the next one', () => {
    const now = asg({ startDate: '2026-10-01', endDate: '2026-11-29', programName: 'Now' });
    const later = asg({ startDate: '2026-12-01', endDate: '2026-12-28', programName: 'Later' });
    expect(only({ assignments: [later, now] }).program).toEqual({ name: 'Now', startDate: '2026-10-01', endDate: '2026-11-29' });
    expect(only({ assignments: [later] }).program).toEqual({ name: 'Later', startDate: '2026-12-01', endDate: '2026-12-28' });
    expect(only({ assignments: [asg({ endDate: '2026-11-01' })] }).program).toBeNull();
  });

  it('carries the last workout date through', () => {
    expect(only({ clients: [client({ lastFinishedOn: '2026-11-02' })] }).lastWorkoutOn).toBe('2026-11-02');
  });

  it('only checks the clients it is given, and keeps other clients\' workouts out', () => {
    const checks = checkClients(input({ clients: [client(), client({ id: 'c2' })], workouts: [wk('2026-11-03', { clientId: 'c2' }), tomorrow()] }));
    expect(checks.map((c) => [c.clientId, kinds(c)])).toEqual([['c1', []], ['c2', ['missed', 'nothing_planned']]]);
  });

  it('checkClient gives the same answer for one client', () => {
    const i = input({ workouts: [wk('2026-11-03')] });
    expect(checkClient(i.clients[0]!, i)).toEqual(checkClients(i)[0]);
  });
});

describe('attentionGroups', () => {
  it('groups clients by reason in a fixed order, problems first and celebrations last', () => {
    const i = input({
      clients: [client({ id: 'a' }), client({ id: 'b' }), client({ id: 'c' }), client({ id: 'd', lastFinishedOn: '2026-10-25' })],
      workouts: [wk('2026-11-03', { clientId: 'a' }), wk('2026-11-03', { clientId: 'b' }), wk('2026-11-04', { clientId: 'b' }), wk('2026-11-06', { clientId: 'd' })],
      assignments: [asg({ clientId: 'c', endDate: '2026-11-07' })],
      prs: [{ clientId: 'd', logId: 'l', exerciseId: 'x', achievedAt: '2026-11-03T10:00:00Z' }],
    });
    const groups = attentionGroups(checkClients(i));
    expect(groups.map((g) => [g.kind, g.items.map((it) => it.clientId)])).toEqual([
      ['missed_in_a_row', ['b']],
      ['missed', ['a']],
      ['program_ending', ['c']],
      ['nothing_planned', ['a', 'b']],
      ['quiet', ['d']],
      ['new_bests', ['d']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(attentionGroups(checkClients(input({ workouts: [tomorrow()] })))).toEqual([]);
  });

  it('puts the longest run and the soonest end first', () => {
    const i = input({
      clients: [client({ id: 'a' }), client({ id: 'b' }), client({ id: 'c' }), client({ id: 'd' })],
      workouts: [
        ...['2026-11-03', '2026-11-04'].map((d) => wk(d, { clientId: 'a' })),
        ...['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => wk(d, { clientId: 'b' })),
      ],
      assignments: [asg({ clientId: 'c', endDate: '2026-11-10' }), asg({ clientId: 'd', endDate: '2026-11-06' })],
    });
    const groups = attentionGroups(checkClients(i));
    expect(groups.find((g) => g.kind === 'missed_in_a_row')!.items.map((it) => it.clientId)).toEqual(['b', 'a']);
    expect(groups.find((g) => g.kind === 'program_ending')!.items.map((it) => it.clientId)).toEqual(['d', 'c']);
  });
});

describe('compareClientChecks', () => {
  const people = [
    { check: { ...only({}), clientId: 'x', lastWorkoutOn: '2026-11-01', program: { name: 'P', startDate: '2026-10-01', endDate: '2026-11-20' } }, firstName: 'Ann', lastName: 'Zed' },
    { check: { ...only({}), clientId: 'y', lastWorkoutOn: null, program: null }, firstName: 'Bo', lastName: 'Adams' },
    { check: { ...only({}), clientId: 'z', lastWorkoutOn: '2026-11-04', program: { name: 'Q', startDate: '2026-10-01', endDate: '2026-11-08' } }, firstName: 'Cy', lastName: 'Moss' },
  ];
  const ids = (sort: 'name' | 'last_workout' | 'end_date') => [...people].sort(compareClientChecks(sort)).map((p) => p.check.clientId);

  it('sorts by last name', () => expect(ids('name')).toEqual(['y', 'z', 'x']));
  it('sorts by most recent workout, never-trained last', () => expect(ids('last_workout')).toEqual(['z', 'x', 'y']));
  it('sorts by soonest program end, no program last', () => expect(ids('end_date')).toEqual(['z', 'x', 'y']));
});

describe('lastWorkoutLabel', () => {
  it.each([
    ['2026-11-05', 'Today'],
    ['2026-11-04', 'Yesterday'],
    ['2026-10-30', '6 days ago'],
    ['2026-10-29', '1 week ago'],
    ['2026-10-15', '3 weeks ago'],
    ['2026-09-06', '8 weeks ago'],
  ])('%s is %s', (date, label) => {
    expect(lastWorkoutLabel(date, TODAY, '2026-01-01', 90)).toBe(label);
  });

  it('says none yet for a client who joined inside the lookback, and over N days for one who joined before it', () => {
    expect(lastWorkoutLabel(null, TODAY, '2026-10-20', 90)).toBe('None yet');
    expect(lastWorkoutLabel(null, TODAY, '2026-01-01', 90)).toBe('Over 90 days ago');
  });
});
