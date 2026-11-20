import { describe, expect, it } from 'vitest';
import type { StrengthPoint } from '../../src/awards/strength-series';
import { strengthSeries, strengthSeriesAll } from '../../src/awards/strength-series';
import {
  heaviestChange,
  heaviestChart,
  heaviestSentence,
  heaviestSessionRows,
  heaviestSessions,
  heaviestTile,
  loadStyleOf,
  loadText,
  sessionsSince,
  strengthExerciseRows,
  strengthStats,
} from '../../src/progress/heaviest';
import { EX_A, mkLog } from '../awards/helpers';

const today = '2026-11-19';
const pt = (date: string, heavy: [number, number], best: [number, number] = heavy, logId = `log-${date}`): StrengthPoint => ({
  date,
  e1rmKg: Math.round(best[0] * (1 + best[1] / 30) * 10) / 10,
  bestSet: { weightKg: best[0], reps: best[1] },
  heaviestSet: { weightKg: heavy[0], reps: heavy[1] },
  logId,
  logName: 'Lower Body',
});

describe('loadStyleOf', () => {
  it('reads weighted bodyweight moves as added weight and assisted ones as help', () => {
    expect(loadStyleOf('Barbell Squat')).toBe('weight');
    expect(loadStyleOf('Lat Pulldown')).toBe('weight');
    expect(loadStyleOf('Pull-ups')).toBe('added');
    expect(loadStyleOf('Pullups')).toBe('added');
    expect(loadStyleOf('Weighted Chin Up')).toBe('added');
    expect(loadStyleOf('Dips')).toBe('added');
    expect(loadStyleOf('Machine Assisted Pull Up')).toBe('assisted');
    expect(loadStyleOf('Band Assisted Pull-Up')).toBe('assisted');
    expect(loadStyleOf('Dip Machine')).toBe('weight');
    expect(loadStyleOf('Back Extension Machine')).toBe('weight');
  });
});

describe('loadText', () => {
  it('writes the weight in the viewer units, with + for added weight and "assist" for help', () => {
    expect(loadText(82.5, 'kg', 'weight')).toBe('82.5 kg');
    expect(loadText(7.5, 'kg', 'added')).toBe('+7.5 kg');
    expect(loadText(20, 'kg', 'assisted')).toBe('20 kg assist');
    expect(loadText(81.647, 'lb', 'weight')).toBe('180 lb');
  });
});

describe('strengthSeries', () => {
  it('keeps each workout heaviest set, its log and name', () => {
    const log = mkLog([{ sets: [{ w: 100, r: 8 }, { w: 105, r: 3 }, { w: 105, r: 2 }] }], { finishedAt: '2026-11-03T10:00:00.000Z', name: 'Legs' });
    const [p] = strengthSeries([log], EX_A);
    expect(p?.heaviestSet).toEqual({ weightKg: 105, reps: 3 });
    expect(p?.bestSet).toEqual({ weightKg: 100, reps: 8 });
    expect(p?.logId).toBe(log.id);
    expect(p?.logName).toBe('Legs');
  });
});

describe('strengthSeries and the one estimated-max rule', () => {
  it('keeps the best estimate from any set of 1–12 reps, and none for high reps or bodyweight styles', () => {
    const log = mkLog([{ sets: [{ w: 60, r: 20 }, { w: 50, r: 10 }, { w: 40, r: 1 }] }], { finishedAt: '2026-11-03T10:00:00.000Z' });
    const [p] = strengthSeries([log], EX_A);
    expect(p?.e1rm).toEqual({ kg: 66.7, set: { weightKg: 50, reps: 10 } });
    expect(p?.heaviestSet).toEqual({ weightKg: 60, reps: 20 });
    const high = mkLog([{ sets: [{ w: 60, r: 20 }] }], { finishedAt: '2026-11-04T10:00:00.000Z' });
    expect(strengthSeries([high], EX_A)[0]?.e1rm).toBeNull();
  });
  it('reads every exercise of each log once (strengthSeriesAll matches strengthSeries)', () => {
    const logs = [mkLog([{ sets: [{ w: 100, r: 5 }] }], { finishedAt: '2026-11-03T10:00:00.000Z' })];
    expect(strengthSeriesAll(logs).get(EX_A)).toEqual(strengthSeries(logs, EX_A));
  });
});

describe('heaviestSessions', () => {
  it('tags only the session holding the heaviest set of all as "Heaviest yet"', () => {
    const s = heaviestSessions([pt('2026-09-02', [65, 5]), pt('2026-09-09', [70, 5]), pt('2026-09-16', [75, 3]), pt('2026-09-23', [67.5, 5]), pt('2026-09-30', [75, 3])], 'weight');
    expect(s.map((x) => x.heaviestYet)).toEqual([false, false, true, false, false]);
    expect(heaviestSessions([pt('2026-09-02', [65, 5])], 'weight')[0]?.heaviestYet).toBe(false);
  });
  it('uses the stored best estimate (any set of 1–12 reps), and none when the session has none', () => {
    const p: StrengthPoint = { ...pt('2026-09-02', [100, 15]), e1rm: { kg: 93.3, set: { weightKg: 80, reps: 5 } } };
    expect(heaviestSessions([p], 'weight')[0]?.e1rm).toEqual({ kg: 93.3, from: { weightKg: 80, reps: 5 } });
    expect(heaviestSessions([{ ...p, e1rm: null }], 'weight')[0]?.e1rm).toBeNull();
  });
  it('estimates the 1-rep max from sets of 12 reps or fewer, and a single is its own max', () => {
    const [a, b, c] = heaviestSessions([pt('2026-09-02', [100, 1]), pt('2026-09-09', [60, 20], [60, 20]), pt('2026-09-16', [80, 5])], 'weight');
    expect(a?.e1rm).toEqual({ kg: 100, from: { weightKg: 100, reps: 1 } });
    expect(b?.e1rm).toBeNull();
    expect(c?.e1rm?.kg).toBe(93.3);
  });
  it('gives no 1-rep max for bodyweight styles and counts least help as best when assisted', () => {
    const s = heaviestSessions([pt('2026-09-02', [30, 6]), pt('2026-09-09', [20, 6]), pt('2026-09-16', [25, 8])], 'assisted');
    expect(s.map((x) => x.e1rm)).toEqual([null, null, null]);
    expect(s.map((x) => x.heaviestYet)).toEqual([false, true, false]);
  });
  it('reads a point saved before heaviest sets were kept from its best set', () => {
    const [s] = heaviestSessions([{ date: '2026-09-02', e1rmKg: 93.3, bestSet: { weightKg: 80, reps: 5 } }], 'weight');
    expect(s?.heaviest).toEqual({ weightKg: 80, reps: 5 });
    expect(s?.logId).toBeNull();
    expect(s?.workoutName).toBeNull();
  });
});

describe('heaviestChange and strengthStats', () => {
  const sessions = heaviestSessions([pt('2026-09-02', [65, 5]), pt('2026-10-01', [82.5, 3], [80, 5]), pt('2026-11-17', [80, 5])], 'weight');
  it('compares the best session in the range with its first', () => {
    expect(heaviestChange(sessions, 'kg', 'weight', today)).toMatchObject({ short: '+17.5 kg', text: '+17.5 kg since 2 Sep', direction: 'up' });
  });
  it('fills both tiles', () => {
    const stats = strengthStats(sessions, 'kg', 'weight', today);
    expect(stats).toMatchObject({ heaviest: '82.5 kg', heaviestDetail: '82.5 kg × 3 on 1 Oct', e1rm: '93.3 kg', e1rmDetail: 'From 80 kg × 5' });
    expect(stats.change?.short).toBe('+17.5 kg');
  });
  it('works in pounds from the shown numbers', () => {
    expect(heaviestChange(sessions, 'lb', 'weight', today)?.short).toBe('+39 lb');
  });
  it('has no change with one session and says why there is no estimate', () => {
    const one = heaviestSessions([pt('2026-09-02', [7.5, 6])], 'added');
    expect(heaviestChange(one, 'kg', 'added', today)).toBeNull();
    expect(strengthStats(one, 'kg', 'added', today)).toMatchObject({ heaviest: '+7.5 kg', e1rm: null, e1rmDetail: 'Not estimated for bodyweight lifts' });
    const high = heaviestSessions([pt('2026-09-02', [40, 15])], 'weight');
    expect(strengthStats(high, 'kg', 'weight', today).e1rmDetail).toBe('Needs a set of 12 reps or fewer');
    expect(strengthStats([], 'kg', 'weight', today)).toMatchObject({ heaviest: null, e1rm: null });
  });
  it('counts less help as progress for assisted lifts', () => {
    const s = heaviestSessions([pt('2026-09-02', [30, 6]), pt('2026-10-02', [20, 6])], 'assisted');
    expect(heaviestChange(s, 'kg', 'assisted', today)).toMatchObject({ short: '−10 kg assist', direction: 'up', amount: 10 });
  });
});

describe('heaviestSentence', () => {
  const s = heaviestSessions([pt('2026-09-02', [65.317, 5]), pt('2026-11-17', [82.554, 3])], 'weight');
  it('says how much more the client lifts, with a verb from the name', () => {
    expect(heaviestSentence('Barbell Squat', s, 'lb', 'weight', today, true)).toBe('You squat 38 lb more than when you started. Nice work.');
    expect(heaviestSentence('Leg Press Machine', s, 'kg', 'weight', today, false)).toBe('You press 17.3 kg more than on 2 Sep. Nice work.');
    expect(heaviestSentence('Lunge', s, 'kg', 'weight', today, true)).toBe('You lift 17.3 kg more on Lunge than when you started. Nice work.');
  });
  it('covers steady, one session, none, added and assisted', () => {
    const flat = heaviestSessions([pt('2026-09-02', [60, 5]), pt('2026-09-09', [60, 3])], 'weight');
    expect(heaviestSentence('Squat', flat, 'kg', 'weight', today, true)).toBe('Your heaviest is holding steady since 2 Sep.');
    expect(heaviestSentence('Squat', s.slice(0, 1), 'kg', 'weight', today, true)).toBe('One workout in this range. Log it again to see a trend.');
    expect(heaviestSentence('Squat', [], 'kg', 'weight', today, true)).toBe('No workouts with this exercise in this range.');
    const added = heaviestSessions([pt('2026-09-02', [2.5, 6]), pt('2026-10-02', [7.5, 5])], 'added');
    expect(heaviestSentence('Pull-ups', added, 'kg', 'added', today, true)).toBe('You add 5 kg more than when you started. Nice work.');
    const assisted = heaviestSessions([pt('2026-09-02', [30, 6]), pt('2026-10-02', [20, 6])], 'assisted');
    expect(heaviestSentence('Assisted Pull-up', assisted, 'kg', 'assisted', today, true)).toBe('You need 10 kg less help than when you started. Nice work.');
  });
});

describe('heaviestSessionRows', () => {
  it('lists newest first with the heaviest set, when, workout and tag', () => {
    const rows = heaviestSessionRows(heaviestSessions([pt('2026-11-10', [80, 4]), pt('2026-11-17', [82.5, 3])], 'weight'), 'kg', 'weight', today);
    expect(rows[0]).toMatchObject({ logId: 'log-2026-11-17', set: '82.5 kg × 3', meta: 'Tue 17 Nov · Lower Body', heaviestYet: true });
    expect(rows[0]?.label).toBe('Tue 17 Nov, Lower Body: heaviest set 82.5 kg × 3, estimated 1-rep max 90.8 kg. Heaviest yet.');
    expect(rows[1]?.heaviestYet).toBe(false);
  });
});

describe('heaviestChart', () => {
  it('gives the heaviest and estimate per session and a text alternative', () => {
    const c = heaviestChart('Squat', heaviestSessions([pt('2026-09-02', [65, 5]), pt('2026-11-17', [82.5, 3])], 'weight'), 'kg', 'weight', today);
    expect(c.points.map((p) => [p.heaviestKg, p.e1rmKg])).toEqual([[65, 75.8], [82.5, 90.8]]);
    expect(c.summary).toBe(
      'Squat, heaviest weight per session: 2 sessions, from 65 kg on 2 Sep to 82.5 kg on 17 Nov. Heaviest 82.5 kg on 17 Nov. The dashed line is the estimated 1-rep max, best 90.8 kg on 17 Nov.',
    );
  });
});

describe('sessionsSince', () => {
  it('keeps the sessions inside the range', () => {
    const s = [{ date: '2026-01-01' }, { date: '2026-10-01' }];
    expect(sessionsSince(s, 91, today)).toEqual([{ date: '2026-10-01' }]);
    expect(sessionsSince(s, null, today)).toHaveLength(2);
  });
});

describe('strengthExerciseRows', () => {
  it('lists exercises most recently trained first with their numbers', () => {
    const rows = strengthExerciseRows(
      [
        { exerciseId: 'a', name: 'Barbell Squat', points: [pt('2026-09-02', [65, 5]), pt('2026-11-17', [82.5, 3])] },
        { exerciseId: 'b', name: 'Pull-ups', points: [pt('2026-11-18', [7.5, 6])] },
        { exerciseId: 'c', name: 'Old Curl', points: [pt('2025-01-01', [10, 10])] },
      ],
      'kg',
      today,
      365,
    );
    expect(rows.map((r) => r.exerciseId)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ heaviest: '+7.5 kg', sinceStart: null, lastSession: '+7.5 kg × 6 · Yesterday', style: 'added' });
    expect(rows[1]).toMatchObject({ heaviest: '82.5 kg', sinceStart: '+17.5 kg', direction: 'up', trend: [65, 82.5], sessionCount: 2 });
  });
});

describe('heaviestTile', () => {
  it('shows the 3-month change in heaviest weight, or the heaviest with one session', () => {
    expect(heaviestTile({ name: 'Squat', points: [pt('2026-09-02', [65, 5]), pt('2026-11-17', [82.5, 3])] }, 'kg', today)).toEqual({ value: 'Squat +17.5 kg', sub: 'heaviest since 2 Sep' });
    expect(heaviestTile({ name: 'Squat', points: [pt('2026-11-17', [82.5, 3])] }, 'kg', today)).toEqual({ value: 'Squat 82.5 kg', sub: 'heaviest' });
    expect(heaviestTile(undefined, 'kg', today)).toEqual({ value: 'No lifts yet', sub: 'log a workout to start' });
  });
});
