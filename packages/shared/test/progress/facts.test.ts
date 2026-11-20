import { describe, expect, it } from 'vitest';
import type { NamedRecord } from '../../src/awards/bests';
import {
  AWARD_SETTLE_MS,
  awaitingAward,
  awaitingLogIds,
  bestsRow,
  consistencyRow,
  progressFacts,
  progressHeadline,
  streakFrom,
  streakWords,
  weekWords,
  zooRow,
  type ProgressFactsInput,
} from '../../src/progress/facts';
import { planned } from './fixtures';

// Thursday 19 November 2026: this week is Mon 16 to Sun 22 November.
const today = '2026-11-19';
const now = Date.parse('2026-11-19T12:00:00Z');
const stats = { streak: 2, streakWeek: '2026-11-16', bestStreak: 4 };
const rec = (exerciseId: string, name: string, kind: 'heaviest' | 'e1rm', valueKg: number, reps: number | null, achievedAt: string): NamedRecord => ({
  exerciseId,
  name,
  kind,
  valueKg,
  reps,
  achievedAt,
});

const base = (over: Partial<ProgressFactsInput> = {}): ProgressFactsInput => ({
  hub: {
    finished: [
      { day: '2026-11-10', planned: true, at: '2026-11-10T10:00:00Z', logId: 'a', awarded: true },
      { day: '2026-11-17', planned: true, at: '2026-11-17T10:00:00Z', logId: 'b', awarded: true },
    ],
    workouts: [planned('2026-11-17', true), planned('2026-11-18', true), planned('2026-11-19', true), planned('2026-11-21')],
    records: [
      rec('sq', 'Barbell Squat', 'heaviest', 62.5, 8, '2026-11-17T10:00:00Z'),
      rec('sq', 'Barbell Squat', 'e1rm', 79, null, '2026-11-17T10:00:00Z'),
      rec('bp', 'Bench Press', 'heaviest', 50, 5, '2026-11-10T10:00:00Z'),
    ],
    prEvents: [
      { clientId: 'me', logId: 'b', exerciseId: 'sq', achievedAt: '2026-11-17T10:00:00Z' },
      { clientId: 'me', logId: 'a', exerciseId: 'bp', achievedAt: '2026-11-10T10:00:00Z' },
      { clientId: 'me', logId: 'z', exerciseId: 'bp', achievedAt: '2026-10-10T10:00:00Z' },
    ],
  },
  album: {
    stickers: [
      { key: 'corgi', shiny: false, firstEarnedAt: '2026-11-10T10:00:00Z' },
      { key: 'polar-bear', shiny: false, firstEarnedAt: '2026-11-17T10:00:00Z' },
      { key: 'not-a-sticker', shiny: false, firstEarnedAt: '2026-11-18T10:00:00Z' },
    ],
    stats,
  },
  uploading: false,
  userId: 'me',
  today,
  timeZone: 'UTC',
  units: 'kg',
  nowMs: now,
  ...over,
});

describe('progressFacts', () => {
  it('works out the streak, this week, bests and stickers in one place', () => {
    const f = progressFacts(base());
    expect(f.updating).toBe(false);
    expect(f.streak).toEqual({ current: 2, best: 4 });
    expect(f.week).toMatchObject({ done: 3, planned: 4, streak: 2, prs: 1 });
    expect(f.bests).toEqual({ thisMonth: 2, total: 2, latest: { exerciseId: 'sq', name: 'Barbell Squat', value: '62.5 kg × 8' } });
    expect(f.stickers?.count).toBe(2);
    expect(f.stickers?.newest?.key).toBe('polar-bear');
  });

  it('is updating while a finished workout is uploading or waiting for its award, never "None yet"', () => {
    expect(progressFacts(base({ uploading: true })).updating).toBe(true);
    const hub = base().hub!;
    const waiting = { ...hub, finished: [...hub.finished, { day: today, planned: true, at: '2026-11-19T11:50:00Z', logId: 'c', awarded: false }] };
    const f = progressFacts(base({ hub: waiting }));
    expect(f.updating).toBe(true);
    expect(bestsRow(f)?.value).toBe('Updating…');
    expect(zooRow(f)?.value).toBe('Updating…');
    expect(consistencyRow(f, true)?.value).toBe('Updating…');
    expect(progressHeadline(f, true)?.strong).toBe('Updating…');
    // Offline: the saved numbers, never "Updating…".
    const offline = progressFacts(base({ hub: waiting, uploading: true, offline: true }));
    expect(offline.updating).toBe(false);
    expect(bestsRow(offline)?.value).toBe('2 this month');
  });

  it('uses the phone’s finished workouts for the streak until the server stores one, and waits for data', () => {
    expect(progressFacts(base({ album: { stickers: [], stats: null } })).streak).toEqual({ current: 2, best: 2 });
    const empty = progressFacts(base({ hub: null, album: null }));
    expect(empty).toMatchObject({ streak: null, week: null, bests: null, stickers: null });
    expect(bestsRow(empty)).toBeNull();
    expect(zooRow(empty)).toBeNull();
    expect(progressHeadline(empty, false)).toBeNull();
  });
});

describe('awaitingAward', () => {
  it('only counts a recent finished workout with no award (older copies without the fields never do)', () => {
    expect(awaitingAward([{ day: today, planned: true, at: new Date(now - 60_000).toISOString(), awarded: false }], now)).toBe(true);
    expect(awaitingAward([{ day: today, planned: true, at: new Date(now - AWARD_SETTLE_MS - 1).toISOString(), awarded: false }], now)).toBe(false);
    expect(awaitingAward([{ day: today, planned: true }], now)).toBe(false);
    expect(awaitingAward([{ day: today, planned: true, at: new Date(now).toISOString(), awarded: true }], now)).toBe(false);
  });
});

describe('awaitingLogIds', () => {
  it('lists the recent unawarded logs the phone keeps asking about', () => {
    const recent = new Date(now - 60_000).toISOString();
    expect(
      awaitingLogIds(
        [
          { day: today, planned: true, at: recent, logId: 'a', awarded: false },
          { day: today, planned: true, at: recent, logId: 'b', awarded: true },
          { day: today, planned: true, at: new Date(now - AWARD_SETTLE_MS - 1).toISOString(), logId: 'c', awarded: false },
        ],
        now,
      ),
    ).toEqual(['a']);
  });
});

describe('streakFrom', () => {
  it('uses the stored streak as it stands this week', () => {
    expect(streakFrom(stats, [], today)).toEqual({ current: 2, best: 4 });
    expect(streakFrom({ ...stats, streakWeek: '2026-11-02' }, [], today)).toEqual({ current: 0, best: 4 });
  });
});

describe('words', () => {
  it('never says a streak was lost: no streak after one is a new journey', () => {
    expect(streakWords({ current: 3, best: 3 }, true)).toEqual({ title: '3-week streak', line: null });
    expect(streakWords({ current: 0, best: 4 }, true).title).toBe('A new journey');
    expect(streakWords({ current: 0, best: 4 }, true).line).toMatch(/landmarks stay/);
    expect(streakWords({ current: 0, best: 0 }, false).title).toBe('Your journey starts here');
    for (const w of [streakWords({ current: 0, best: 4 }, true), streakWords({ current: 0, best: 0 }, false)]) {
      expect(`${w.title} ${w.line}`).not.toMatch(/broke|lost|ended|0-week/i);
    }
  });

  it('says the week as counts', () => {
    expect(weekWords({ done: 3, planned: 4, extra: 0 })).toBe('3 of 4 this week');
    expect(weekWords({ done: 1, planned: 1, extra: 1 })).toBe('1 of 1 this week +1');
    expect(weekWords({ done: 0, planned: 0, extra: 2 })).toBe('2 workouts this week');
    expect(weekWords({ done: 0, planned: 0, extra: 0 })).toBe('Nothing planned yet this week');
  });

  it('builds the Progress hub rows as on the approved board', () => {
    const f = progressFacts(base());
    expect(bestsRow(f)).toEqual({ value: '2 this month', sub: 'Latest: Barbell Squat 62.5 kg × 8' });
    expect(consistencyRow(f, true)).toEqual({ value: '3 of 4 this week', sub: '2-week streak' });
    expect(zooRow(f)).toEqual({ value: '2 stickers', sub: 'Newest: Polar bear' });
    expect(progressHeadline(f, true)).toEqual({ strong: '2-week streak', rest: '3 of 4 workouts this week' });
    const none = progressFacts(base({ hub: { ...base().hub!, records: [], prEvents: [] }, album: { stickers: [], stats: null } }));
    expect(bestsRow(none)).toEqual({ value: 'None yet', sub: 'Finish a workout to set one' });
    expect(zooRow(none)).toEqual({ value: 'No stickers yet', sub: 'Finish a workout to earn one' });
    const old = progressFacts(base({ today: '2026-12-02' }));
    expect(bestsRow(old)?.value).toBe('2 bests');
    expect(consistencyRow(progressFacts(base({ album: { stickers: [], stats: { ...stats, streakWeek: '2026-11-02' } } })), true)?.sub).toMatch(/landmarks stay/);
  });
});
