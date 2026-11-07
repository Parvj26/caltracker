import { describe, expect, it } from 'vitest';
import type { WorkoutLogDoc } from '@caltracker/shared';
import { adoptCoachCopy, coachWatchView, latestTickedSetId, logControls, shouldPullCoachCopy } from './coach-watch';
import { sampleLog, upperCoreLog } from './log-fixtures';

const held = { status: 'in_progress' as const, heldByOther: true, canReclaim: false, lastActivityAt: '2026-11-05T09:10:00.000Z' };

/** The sample log with its sets' completedAt set (null = open), in doc order. */
function ticked(times: (string | null)[]): WorkoutLogDoc {
  const log = upperCoreLog();
  let i = 0;
  return {
    ...log,
    blocks: log.blocks.map((b) => ({
      ...b,
      exercises: b.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => ({ ...s, completedAt: i < times.length ? times[i++] : null })),
      })),
    })),
  };
}
const setIds = (log: WorkoutLogDoc) => log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets.map((s) => s.id)));

describe('coachWatchView', () => {
  const log = sampleLog();
  it('shows the read-only pages while the coach logs the open workout', () => {
    expect(coachWatchView(true, log, log.id)).toBe('watch');
  });
  it('falls back to the full banner when the phone has no open copy of it', () => {
    expect(coachWatchView(true, null, log.id)).toBe('banner');
    expect(coachWatchView(true, sampleLog({ id: '00000000-0000-4000-8000-000000000999' }), log.id)).toBe('banner');
    // Finished by the coach: "Your coach logged this session".
    expect(coachWatchView(true, sampleLog({ status: 'completed' }), log.id)).toBe('banner');
  });
  it('is the client’s own logging otherwise', () => {
    expect(coachWatchView(false, log, log.id)).toBe('own');
    expect(coachWatchView(false, null, log.id)).toBe('own');
  });
});

describe('logControls', () => {
  it('offers every control when the client logs', () => {
    expect(Object.values(logControls(false)).every(Boolean)).toBe(true);
  });
  it('read only: only moving around and reading (photos, info, history) stay', () => {
    expect(logControls(true)).toEqual({
      type: false,
      tick: false,
      markAll: false,
      done: false,
      addSet: false,
      deleteSet: false,
      substituteSwitch: false,
      swap: false,
      more: false,
      message: false,
      addExercise: false,
      finish: false,
      discard: false,
      history: true,
      info: true,
      navigate: true,
    });
  });
});

describe('latestTickedSetId', () => {
  it('is null when nothing is ticked', () => {
    expect(latestTickedSetId(ticked([]))).toBeNull();
  });
  it('has enough sets to test with', () => {
    expect(setIds(upperCoreLog()).length).toBeGreaterThanOrEqual(3);
  });
  it('is the set ticked last, wherever it sits', () => {
    const log = ticked(['2026-11-05T09:05:00.000Z', '2026-11-05T09:09:00.000Z', '2026-11-05T09:07:00.000Z']);
    expect(latestTickedSetId(log)).toBe(setIds(log)[1]);
  });
  it('takes the later set on a tie (Mark all ticks several at once)', () => {
    const at = '2026-11-05T09:05:00.000Z';
    const log = ticked([at, at, at]);
    expect(latestTickedSetId(log)).toBe(setIds(log)[2]);
  });
});

describe('shouldPullCoachCopy', () => {
  const local = { status: 'in_progress' as const, heldByOther: true };
  it('pulls the coach’s newer sets while the coach holds the open workout', () => {
    expect(shouldPullCoachCopy(held, local)).toBe(true);
  });
  it('leaves hand back, reclaim, finish and take over to refreshFromServer', () => {
    expect(shouldPullCoachCopy({ ...held, heldByOther: false }, local)).toBe(false);
    expect(shouldPullCoachCopy({ ...held, status: 'completed' }, local)).toBe(false);
    expect(shouldPullCoachCopy(held, { status: 'in_progress', heldByOther: false })).toBe(false);
    expect(shouldPullCoachCopy(held, { status: 'completed', heldByOther: true })).toBe(false);
  });
  it('does nothing without an answer or a local copy', () => {
    expect(shouldPullCoachCopy(null, local)).toBe(false);
    expect(shouldPullCoachCopy(held, null)).toBe(false);
  });
});

describe('adoptCoachCopy', () => {
  const mine = sampleLog({ revision: 5 });
  const stored = { log: mine, lastSyncedRevision: 5 };
  it('takes the coach’s newer copy as synced, so nothing is pushed over it', () => {
    const server = sampleLog({ revision: 6, name: 'Coach copy' });
    expect(adoptCoachCopy(stored, server, mine.id)).toEqual({ log: server, lastSyncedRevision: 6 });
  });
  it('keeps the stored copy when the answer is older or the same (an earlier fetch landing late)', () => {
    expect(adoptCoachCopy(stored, sampleLog({ revision: 5, name: 'Same' }), mine.id)).toBe(stored);
    expect(adoptCoachCopy(stored, sampleLog({ revision: 4 }), mine.id)).toBe(stored);
  });
  it('never adopts once the coach no longer holds it, or for another log', () => {
    const server = sampleLog({ revision: 6 });
    expect(adoptCoachCopy(stored, server, null)).toBe(stored);
    expect(adoptCoachCopy(stored, server, '00000000-0000-4000-8000-000000000999')).toBe(stored);
    expect(adoptCoachCopy(null, server, mine.id)).toBeNull();
    expect(adoptCoachCopy(stored, sampleLog({ id: '00000000-0000-4000-8000-000000000999', revision: 9 }), mine.id)).toBe(stored);
  });
  it('leaves a finished or discarded copy to refreshFromServer, which ends the workout properly', () => {
    expect(adoptCoachCopy(stored, sampleLog({ revision: 6, status: 'completed' }), mine.id)).toBe(stored);
  });
});
