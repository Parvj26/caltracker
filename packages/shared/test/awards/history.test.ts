import { describe, expect, it } from 'vitest';
import { computeAward } from '../../src/awards/award';
import {
  awardContext,
  awardedStickers,
  clientStatsAt,
  firstLogExercises,
  mergeRecords,
  replayRecords,
  safeTimeZone,
} from '../../src/awards/history';
import { localDay } from '../../src/awards/streak';
import { EX_A, EX_B, mkLog } from './helpers';
import type { S } from './helpers';

// A completed log of EX_A finished at the given instant, with the given sets.
const at = (finishedAt: string, sets: S[], exerciseId = EX_A) =>
  mkLog([{ exerciseId, sets }], { finishedAt, lastActivityAt: finishedAt });

describe('safeTimeZone', () => {
  it('keeps a valid IANA zone', () => {
    expect(safeTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(safeTimeZone('UTC')).toBe('UTC');
  });
  it('falls back to UTC for a zone Intl refuses, or none', () => {
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeTimeZone('')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });
});

describe('localDay', () => {
  it('is the calendar day in that zone', () => {
    expect(localDay('2026-11-09T07:30:00Z', 'America/Los_Angeles')).toBe('2026-11-08');
    expect(localDay('2026-11-09T07:30:00Z', 'UTC')).toBe('2026-11-09');
  });
});

describe('mergeRecords', () => {
  it('keeps the better of the stored record and the log, per kind and per weight', () => {
    const first = mergeRecords([], at('2026-11-02T10:00:00Z', [{ w: 100, r: 5 }, { w: 80, r: 8 }]));
    const second = mergeRecords(first, at('2026-11-03T10:00:00Z', [{ w: 90, r: 6 }, { w: 80, r: 10 }]));
    const get = (kind: string, w?: number) =>
      second.find((r) => r.kind === kind && (w === undefined || r.valueKg === w));
    expect(get('heaviest')).toMatchObject({ valueKg: 100, reps: 5 });
    expect(get('reps_at_weight', 80)).toMatchObject({ reps: 10 });
    expect(get('reps_at_weight', 90)).toMatchObject({ reps: 6 });
    expect(get('reps_at_weight', 100)).toMatchObject({ reps: 5 });
    expect(second.filter((r) => r.kind === 'heaviest')).toHaveLength(1);
    expect(second.filter((r) => r.kind === 'e1rm')).toHaveLength(1);
  });
  it('a tie keeps the earlier record', () => {
    const a = at('2026-11-02T10:00:00Z', [{ w: 100, r: 5 }]);
    const merged = mergeRecords(mergeRecords([], a), at('2026-11-03T10:00:00Z', [{ w: 100, r: 5 }]));
    expect(merged.every((r) => r.logId === a.id)).toBe(true);
  });
});

describe('firstLogExercises', () => {
  it('names the exercises with no stored record', () => {
    const history = mergeRecords([], at('2026-11-02T10:00:00Z', [{ w: 100, r: 5 }]));
    const log = mkLog([{ exerciseId: EX_A, sets: [{ w: 50, r: 5 }] }, { exerciseId: EX_B, sets: [{ w: 50, r: 5 }] }]);
    expect([...firstLogExercises(log, history)]).toEqual([EX_B]);
  });
});

describe('replayRecords', () => {
  it('replays in finish order, whatever order the logs come in', () => {
    const l1 = at('2026-11-02T10:00:00Z', [{ w: 100, r: 5 }]);
    const l2 = at('2026-11-03T10:00:00Z', [{ w: 110, r: 5 }]);
    const l3 = at('2026-11-04T10:00:00Z', [{ w: 105, r: 5 }]);
    const r = replayRecords([l3, l1, l2]);
    expect(r.prs.get(l1.id)).toEqual([]); // the baseline
    expect(r.prs.get(l2.id)?.map((p) => p.kind).sort()).toEqual(['e1rm', 'heaviest']);
    expect(r.prs.get(l3.id)).toEqual([]); // 105 at 5 reps: a weight never lifted, and lighter than 110
    expect(r.records.find((x) => x.kind === 'heaviest')).toMatchObject({ valueKg: 110, logId: l2.id });
  });
  it('ignores logs that are not completed', () => {
    const l1 = at('2026-11-02T10:00:00Z', [{ w: 100, r: 5 }]);
    const open = mkLog([{ sets: [{ w: 200, r: 5 }] }], { status: 'in_progress', finishedAt: null });
    const r = replayRecords([l1, open]);
    expect(r.prs.has(open.id)).toBe(false);
    expect(r.records.find((x) => x.kind === 'heaviest')?.valueKg).toBe(100);
  });
  it('a lowered log gives the record back to the earlier log (a coach correction)', () => {
    const l1 = at('2026-11-02T10:00:00Z', [{ w: 100, r: 5 }]);
    const l2 = at('2026-11-03T10:00:00Z', [{ w: 70, r: 5 }]); // was 120, corrected to 70
    const r = replayRecords([l1, l2]);
    expect(r.prs.get(l2.id)).toEqual([]);
    expect(r.records.find((x) => x.kind === 'heaviest')).toMatchObject({ valueKg: 100, logId: l1.id });
  });
});

describe('clientStatsAt', () => {
  it('counts workouts, volume, streak in the zone and this month', () => {
    const logs = [
      at('2026-10-20T10:00:00Z', [{ w: 100, r: 10 }]), // week of 10-19, October
      at('2026-10-28T10:00:00Z', [{ w: 100, r: 10 }]), // week of 10-26, October
      at('2026-11-03T10:00:00Z', [{ w: 50, r: 10 }]), // week of 11-02, November
    ];
    expect(clientStatsAt(logs, 'UTC', '2026-11-04T00:00:00Z', 2)).toEqual({
      workouts: 3,
      streak: 3,
      bestStreak: 3,
      prCount: 2,
      lifetimeVolumeKg: 2500,
      monthVolumeKg: 500,
    });
    // Two weeks later with nothing new: the streak is over, the best stays.
    expect(clientStatsAt(logs, 'UTC', '2026-11-17T00:00:00Z', 2)).toMatchObject({ streak: 0, bestStreak: 3 });
  });
  it('a Sunday 11:30 pm workout in LA counts for that week', () => {
    const logs = [at('2026-11-02T10:00:00Z', [{ w: 1, r: 1 }]), at('2026-11-16T07:30:00Z', [{ w: 1, r: 1 }])];
    // 2026-11-16T07:30Z is Sunday 15 Nov, 11:30 pm in LA: the week of 11-09, so weeks 11-02 and 11-09 run on.
    expect(clientStatsAt(logs, 'America/Los_Angeles', '2026-11-16T07:30:00Z', 0).streak).toBe(2);
    expect(clientStatsAt(logs, 'UTC', '2026-11-16T07:30:00Z', 0).streak).toBe(1);
  });
});

describe('awardContext', () => {
  const l1 = at('2026-10-27T10:00:00Z', [{ w: 100, r: 5 }]);
  const l2 = at('2026-11-03T10:00:00Z', [{ w: 120, r: 5 }]);
  const l3 = at('2026-11-04T10:00:00Z', [{ w: 90, r: 5 }]);

  it('judges the log against the logs finished before it', () => {
    const c = awardContext([l1, l2, l3], l2.id, 'UTC', '2026-11-05T00:00:00Z');
    expect(c.log.id).toBe(l2.id);
    expect(c.prHistory.find((r) => r.kind === 'heaviest')?.valueKg).toBe(100);
    expect([...c.firstLogOfExercise]).toEqual([]);
    expect(c.statsBefore).toMatchObject({ workouts: 1, streak: 1, prCount: 0 });
    expect(c.statsAfter).toMatchObject({ workouts: 2, streak: 2, prCount: 2 });
    // The stored records and stats cover every log, up to now.
    expect(c.records.find((r) => r.kind === 'heaviest')).toMatchObject({ valueKg: 120, logId: l2.id });
    expect(c.current).toMatchObject({ workouts: 3, streak: 2, prCount: 2 });
    expect(c.currentStreakWeek).toBe('2026-11-02');
    const award = computeAward({ ...c, owned: new Map(), rng: () => 0.5 });
    expect(award.prs.map((p) => p.kind).sort()).toEqual(['e1rm', 'heaviest']);
    expect(award.landmarks).toEqual(['christ-the-redeemer']);
  });
  it('the streak week is the last week that counted, as of now', () => {
    expect(awardContext([l1, l2, l3], l2.id, 'UTC', '2026-11-10T00:00:00Z').currentStreakWeek).toBe('2026-11-02');
    expect(awardContext([l1, l2, l3], l2.id, 'UTC', '2026-11-17T00:00:00Z').currentStreakWeek).toBeNull();
  });
  it('the first log is a baseline and the first milestone', () => {
    const c = awardContext([l1], l1.id, 'UTC', '2026-11-05T00:00:00Z');
    expect([...c.firstLogOfExercise]).toEqual([EX_A]);
    const award = computeAward({ ...c, owned: new Map(), rng: () => 0.5 });
    expect(award.prs).toEqual([]);
    expect(award.milestone).toBe(1);
    expect(award.landmarks).toEqual(['chichen-itza']);
  });
  it('hands over the ladder animals of the logs finished before this one, oldest first', () => {
    const awards = [
      { logId: l3.id, finishedAt: l3.finishedAt!, key: 'goat' },
      { logId: l1.id, finishedAt: l1.finishedAt!, key: 'cat' },
      { logId: l2.id, finishedAt: l2.finishedAt!, key: 'pig' },
    ];
    expect(awardContext([l1, l2, l3], l3.id, 'UTC', '2026-11-05T00:00:00Z', awards).ladderHistory).toEqual(['cat', 'pig']);
    expect(awardContext([l1, l2, l3], l1.id, 'UTC', '2026-11-05T00:00:00Z', awards).ladderHistory).toEqual([]);
    expect(awardContext([l1, l2, l3], l2.id, 'UTC', '2026-11-05T00:00:00Z').ladderHistory).toEqual([]);
  });
  it('refuses a log that is not among the completed logs', () => {
    expect(() => awardContext([l1], l2.id, 'UTC', '2026-11-05T00:00:00Z')).toThrow();
  });
});

describe('awardedStickers', () => {
  it('lists every sticker the award adds, the ladder one with its shiny state', () => {
    expect(
      awardedStickers({
        ladder: { key: 'rhino', multiple: 1.3, isNew: true, count: 1, shiny: true },
        drop: 'kakapo',
        rare: ['axolotl'],
        landmarks: ['colosseum'],
        milestone: 10,
        prs: [],
      }),
    ).toEqual([
      { key: 'rhino', shiny: true },
      { key: 'kakapo', shiny: false },
      { key: 'axolotl', shiny: false },
      { key: 'colosseum', shiny: false },
    ]);
    expect(awardedStickers({ ladder: null, drop: null, rare: [], landmarks: [], milestone: 1, prs: [] })).toEqual([]);
  });
});
