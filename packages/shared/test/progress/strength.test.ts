import { describe, expect, it } from 'vitest';
import {
  bestsList,
  bestsTile,
  exerciseSessions,
  mostTrained,
  pointsInRange,
  sessionRows,
  strengthHeadline,
  strengthPickerSections,
  strengthTile,
} from '../../src/progress/strength';
import type { StrengthPoint } from '../../src/awards/strength-series';
import { EX_A, EX_B, mkLog } from '../awards/helpers';

const today = '2026-11-05';
const pt = (date: string, e1rmKg: number): StrengthPoint => ({ date, e1rmKg, bestSet: { weightKg: e1rmKg, reps: 1 } });
const ex = (exerciseId: string, name: string, dates: string[], muscle: string | null = null) => ({
  exerciseId,
  name,
  muscle,
  points: dates.map((d, i) => pt(d, 100 + i * 5)),
});

describe('mostTrained', () => {
  it('picks the exercises with the most workouts in the last 3 months, most first', () => {
    const list = [
      ex('a', 'Squat', ['2026-10-01', '2026-10-08', '2026-10-15']),
      ex('b', 'Bench', ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23']),
      ex('c', 'Deadlift', ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-10-20']),
      ex('d', 'Row', ['2026-10-03', '2026-10-10']),
    ];
    expect(mostTrained(list, today).map((e) => e.name)).toEqual(['Bench', 'Squat', 'Row']);
    expect(mostTrained(list, today, 1).map((e) => e.name)).toEqual(['Bench']);
  });
  it('breaks a tie by the most recent workout, then by name', () => {
    const list = [ex('a', 'Squat', ['2026-10-01']), ex('b', 'Bench', ['2026-10-09']), ex('c', 'Curl', ['2026-10-09'])];
    expect(mostTrained(list, today).map((e) => e.name)).toEqual(['Bench', 'Curl', 'Squat']);
  });
  it('leaves out exercises not trained in the last 3 months', () => {
    expect(mostTrained([ex('a', 'Squat', ['2026-01-01'])], today)).toEqual([]);
  });
});

describe('pointsInRange', () => {
  const pts = [pt('2026-07-01', 90), pt('2026-10-01', 100), pt('2026-10-20', 105)];
  it('keeps the last month, 3 months, or all', () => {
    expect(pointsInRange(pts, '1m', today).map((p) => p.date)).toEqual(['2026-10-20']);
    expect(pointsInRange(pts, '3m', today).map((p) => p.date)).toEqual(['2026-10-01', '2026-10-20']);
    expect(pointsInRange(pts, 'all', today)).toHaveLength(3);
  });
});

describe('strengthHeadline', () => {
  it('gives the latest estimated max and its change in plain words', () => {
    const h = strengthHeadline([pt('2026-09-06', 100), pt('2026-11-01', 115)], 'kg', today);
    expect(h).toEqual({
      value: '115 kg',
      change: '+15 kg since 6 Sep',
      line: 'Your estimated max is up 15 kg since 6 Sep. Nice progress.',
    });
  });
  it('is kind about a dip and steady about no change', () => {
    expect(strengthHeadline([pt('2026-09-06', 100), pt('2026-11-01', 95)], 'kg', today).line).toBe(
      'Your estimated max is 5 kg under 6 Sep. Ups and downs are normal.',
    );
    expect(strengthHeadline([pt('2026-09-06', 100), pt('2026-11-01', 100)], 'kg', today).change).toBe('No change since 6 Sep');
    expect(strengthHeadline([pt('2026-09-06', 100), pt('2026-11-01', 100)], 'kg', today).line).toBe(
      'Your estimated max is holding steady since 6 Sep.',
    );
  });
  it('works in pounds, from the rounded pounds shown', () => {
    expect(strengthHeadline([pt('2026-09-06', 100), pt('2026-11-01', 115)], 'lb', today).change).toBe('+34 lb since 6 Sep');
  });
  it('handles one workout and none', () => {
    expect(strengthHeadline([pt('2026-11-01', 100)], 'kg', today)).toEqual({
      value: '100 kg',
      change: null,
      line: 'One workout in this range. Log it again to see a trend.',
    });
    expect(strengthHeadline([], 'kg', today)).toEqual({ value: null, change: null, line: 'No workouts with this exercise in this range.' });
  });
});

describe('strengthTile', () => {
  it('shows the most-trained exercise and its 3-month change', () => {
    const list = [ex('a', 'Squat', ['2026-09-06', '2026-10-01', '2026-11-01']), ex('b', 'Bench', ['2026-10-01'])];
    expect(strengthTile(list, 'kg', today)).toEqual({ value: 'Squat +10 kg', sub: 'est. max since 6 Sep' });
  });
  it('shows the latest estimated max with one workout', () => {
    expect(strengthTile([ex('a', 'Squat', ['2026-11-01'])], 'kg', today)).toEqual({ value: 'Squat 100 kg', sub: 'est. max' });
  });
  it('invites a first workout with none', () => {
    expect(strengthTile([], 'kg', today)).toEqual({ value: 'No lifts yet', sub: 'log a workout to start' });
  });
});

describe('strengthPickerSections', () => {
  const list = [
    ex('a', 'Back Squat', ['2026-10-01', '2026-11-01'], 'quadriceps'),
    ex('b', 'Bench Press', ['2026-10-30'], 'chest'),
    ex('c', 'Leg Press', ['2026-09-01'], 'quadriceps'),
    ex('d', 'Plank Row', ['2026-08-01'], null),
  ];
  it('lists recent first, then every exercise grouped by primary muscle, with its best', () => {
    const s = strengthPickerSections(list, '', 2);
    expect(s.map((x) => x.title)).toEqual(['Recent', 'Chest', 'Quadriceps', 'Other']);
    expect(s[0]!.items.map((i) => i.name)).toEqual(['Back Squat', 'Bench Press']);
    expect(s[2]!.items.map((i) => i.name)).toEqual(['Back Squat', 'Leg Press']);
    expect(s[0]!.items[0]!.bestKg).toBe(105);
  });
  it('searches by name, ignoring case and accents', () => {
    const s = strengthPickerSections(list, 'PRESS', 2);
    expect(s).toHaveLength(1);
    expect(s[0]!.title).toBe('Results');
    expect(s[0]!.items.map((i) => i.name)).toEqual(['Bench Press', 'Leg Press']);
    expect(strengthPickerSections(list, 'zzz', 2)).toEqual([]);
  });
});

describe('exerciseSessions and sessionRows', () => {
  it('lists the counted sets of each workout with the exercise, newest first', () => {
    const l1 = mkLog([{ exerciseId: EX_A, sets: [{ w: 20, r: 10, type: 'warmup' }, { w: 60, r: 8 }, { w: 60, r: 7 }] }], {
      finishedAt: '2026-11-01T11:00:00.000Z',
    });
    const l2 = mkLog([{ exerciseId: EX_A, sets: [{ w: 65, r: 5 }] }, { exerciseId: EX_B, sets: [{ w: 30, r: 10 }] }], {
      finishedAt: '2026-11-04T11:00:00.000Z',
    });
    const sessions = exerciseSessions([l1, l2], EX_A, 'UTC', 10);
    expect(sessions).toEqual([
      { logId: l2.id, date: '2026-11-04', sets: [{ weightKg: 65, reps: 5 }] },
      { logId: l1.id, date: '2026-11-01', sets: [{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 7 }] },
    ]);
    const rows = sessionRows(sessions, new Set([`${l2.id}|${EX_A}`]), EX_A, 'kg', today);
    expect(rows[0]).toEqual({ logId: l2.id, when: '4 Nov', sets: '65 × 5', pr: true, label: '4 Nov: 65 kg × 5. Personal best.' });
    expect(rows[1]).toMatchObject({ sets: '60 × 8, 60 × 7', pr: false, label: '1 Nov: 60 kg × 8, 60 kg × 7.' });
  });
});

describe('bestsList and bestsTile', () => {
  const rows = [
    { exerciseId: 'a', name: 'Back Squat', weightKg: 100, reps: 5, e1rmKg: 116.7, achievedAt: '2026-11-01T10:00:00Z' },
    { exerciseId: 'b', name: 'Bench', weightKg: 60, reps: null, e1rmKg: null, achievedAt: '2026-11-03T10:00:00Z' },
    { exerciseId: 'c', name: 'Curl', weightKg: null, reps: null, e1rmKg: 30, achievedAt: '2026-10-01T10:00:00Z' },
  ];
  it('lists each best newest first, in words', () => {
    expect(bestsList(rows, 'kg', today, 'UTC')).toEqual([
      { exerciseId: 'b', name: 'Bench', detail: 'Heaviest', value: '60 kg', when: '3 Nov' },
      { exerciseId: 'a', name: 'Back Squat', detail: 'Heaviest · est. max 116.7 kg', value: '100 kg × 5', when: '1 Nov' },
      { exerciseId: 'c', name: 'Curl', detail: 'Est. max', value: '30 kg', when: '1 Oct' },
    ]);
  });
  it('counts the bests and the new ones this week', () => {
    expect(bestsTile(3, 2)).toEqual({ value: '3', sub: '2 new this week' });
    expect(bestsTile(3, 1)).toEqual({ value: '3', sub: '1 new this week' });
    expect(bestsTile(3, 0)).toEqual({ value: '3', sub: 'exercises with a best' });
    expect(bestsTile(0, 0)).toEqual({ value: 'None yet', sub: 'finish a workout to set one' });
  });
});
