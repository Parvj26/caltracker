import { describe, expect, it } from 'vitest';
import { workoutStatuses } from './active-log-logic';
import type { LogForDay } from './log-api';
import { isLogForDay, logsForWeek, logsOfWorkout, parseCachedPlan, type CachedPlan } from './plan-cache';

const log = (over: Partial<LogForDay> = {}): LogForDay => ({
  id: 'l1',
  workoutId: 'w1',
  scheduledOn: '2026-11-09',
  status: 'completed',
  name: 'Upper A',
  startedAt: '2026-11-09T09:00:00.000Z',
  finishedAt: '2026-11-09T09:50:00.000Z',
  lastActivityAt: '2026-11-09T09:50:00.000Z',
  ...over,
});

const doc = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Upper A',
  notes: null,
  sections: [],
  blocks: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      sectionId: null,
      kind: 'straight',
      exercises: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          exerciseId: '00000000-0000-4000-8000-000000000004',
          exerciseName: 'Squat',
          trackingType: 'weight_reps',
          note: null,
          substitutes: [],
          sets: [
            {
              id: '00000000-0000-4000-8000-000000000005',
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
};

const plan = (over: Partial<CachedPlan> = {}): CachedPlan =>
  ({
    weekStart: '2026-11-09',
    week: [{ doc, scheduledOn: '2026-11-09', programName: 'Block', programDay: { week: 1, day: 1 } }],
    comingUp: [],
    logs: [log()],
    ...over,
  }) as unknown as CachedPlan;

describe('parseCachedPlan', () => {
  it('reads back the plan with the week’s logs', () => {
    const back = parseCachedPlan(JSON.stringify(plan()));
    expect(back?.week).toHaveLength(1);
    expect(back?.logs).toEqual([log()]);
  });

  it('keeps an older copy without logs readable, with none', () => {
    const old: Partial<CachedPlan> = plan();
    delete old.logs;
    expect(parseCachedPlan(JSON.stringify(old))?.logs).toEqual([]);
  });

  it('drops unreadable logs and rejects junk', () => {
    expect(parseCachedPlan(JSON.stringify(plan({ logs: [{ id: 1 } as unknown as LogForDay, log({ id: 'l2' })] })))?.logs).toEqual([
      log({ id: 'l2' }),
    ]);
    expect(parseCachedPlan('nope')).toBeNull();
    expect(parseCachedPlan(null)).toBeNull();
  });
});

describe('parseCachedPlan with measurements', () => {
  it('keeps the new tracking types, Each side and Tempo on a saved workout', () => {
    const ex = doc.blocks[0].exercises[0];
    const set0 = ex.sets[0];
    const b = (n: number, e: Record<string, unknown>) => ({ ...doc.blocks[0], id: `00000000-0000-4000-8000-00000000001${n}`, exercises: [{ ...ex, ...e }] });
    const measured = {
      ...doc,
      blocks: [
        b(0, { trackingType: 'weight_reps_time', eachSide: true, tempo: '3-1-1-0', sets: [{ ...set0, targetDurationS: 30 }] }),
        b(1, { id: '00000000-0000-4000-8000-000000000006', trackingType: 'weight', sets: [{ ...set0, id: '00000000-0000-4000-8000-000000000007', targetRepsMin: null, targetRepsMax: null }] }),
        b(2, { id: '00000000-0000-4000-8000-000000000008', trackingType: 'reps_time', sets: [{ ...set0, id: '00000000-0000-4000-8000-000000000009', targetWeightKg: null, targetDurationS: 45 }] }),
      ],
    };
    const back = parseCachedPlan(JSON.stringify(plan({ week: [{ doc: measured, scheduledOn: '2026-11-09', programName: null, programDay: null }] as unknown as CachedPlan['week'] })));
    const exercises = back?.week[0]?.doc.blocks.flatMap((x) => x.exercises) ?? [];
    expect(exercises.map((e) => e.trackingType)).toEqual(['weight_reps_time', 'weight', 'reps_time']);
    expect(exercises[0]).toMatchObject({ eachSide: true, tempo: '3-1-1-0' });
    expect(exercises[0]?.sets[0]).toMatchObject({ targetRepsMin: 8, targetWeightKg: 60, targetDurationS: 30 });
    expect(exercises[2]?.sets[0]).toMatchObject({ targetRepsMin: 8, targetDurationS: 45 });
  });
});

describe('isLogForDay', () => {
  it('accepts a log and rejects a bad status', () => {
    expect(isLogForDay(log())).toBe(true);
    expect(isLogForDay({ ...log(), status: 'weird' })).toBe(false);
  });
});

describe('logsForWeek', () => {
  it('uses the server’s logs when they could be read', () => {
    expect(logsForWeek([], plan(), '2026-11-09')).toEqual([]);
  });

  it('falls back to the saved logs of the same week when they couldn’t', () => {
    expect(logsForWeek(null, plan(), '2026-11-09')).toEqual([log()]);
    expect(logsForWeek(null, plan(), '2026-11-16')).toEqual([]);
    expect(logsForWeek(null, null, '2026-11-09')).toEqual([]);
  });
});

describe('logsOfWorkout', () => {
  it('finds the saved logs of one workout', () => {
    expect(logsOfWorkout(plan(), 'w1')).toEqual([log()]);
    expect(logsOfWorkout(plan(), 'w2')).toEqual([]);
    expect(logsOfWorkout(null, 'w1')).toEqual([]);
  });
});

describe('status with saved logs (no signal)', () => {
  it('keeps a finished workout done, so Start is not offered again', () => {
    const logs = logsForWeek(null, plan(), '2026-11-09');
    expect(workoutStatuses(logs, null)['w1']).toMatchObject({ kind: 'done', logId: 'l1' });
  });

  it('keeps a workout the coach is logging in progress', () => {
    const logs = logsForWeek(null, plan({ logs: [log({ status: 'in_progress', finishedAt: null })] }), '2026-11-09');
    expect(workoutStatuses(logs, null)['w1']).toMatchObject({ kind: 'in_progress', logId: 'l1' });
  });
});
