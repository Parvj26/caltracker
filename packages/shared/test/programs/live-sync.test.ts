import { describe, expect, it } from 'vitest';
import {
  isLiveWorkout,
  liveSyncStatus,
  liveSyncWindow,
  planLiveSync,
  type LiveSyncCopy,
} from '../../src/programs/live-sync';

const today = '2026-11-06';

describe('liveSyncWindow', () => {
  it('runs from today to open-ended for an assignment that started earlier', () => {
    expect(liveSyncWindow({ startDate: '2026-11-04', endDate: '2026-11-17', cancelledOn: null }, today)).toEqual({
      from: '2026-11-06',
      until: null,
    });
  });

  it('starts on the start date when that is later than today', () => {
    expect(liveSyncWindow({ startDate: '2026-11-09', endDate: '2026-11-22', cancelledOn: null }, today)?.from).toBe('2026-11-09');
  });

  it('stops the day before the cancel date', () => {
    expect(liveSyncWindow({ startDate: '2026-11-04', endDate: '2026-11-17', cancelledOn: '2026-11-10' }, today)).toEqual({
      from: '2026-11-06',
      until: '2026-11-09',
    });
  });

  it('is null for an assignment that ended before today or was cancelled from today or earlier', () => {
    expect(liveSyncWindow({ startDate: '2026-10-01', endDate: '2026-11-05', cancelledOn: null }, today)).toBeNull();
    expect(liveSyncWindow({ startDate: '2026-11-01', endDate: '2026-11-20', cancelledOn: '2026-11-06' }, today)).toBeNull();
  });

  it('includes an assignment whose last day is today', () => {
    expect(liveSyncWindow({ startDate: '2026-10-31', endDate: '2026-11-06', cancelledOn: null }, today)).not.toBeNull();
  });
});

describe('planLiveSync', () => {
  const assignment = { startDate: '2026-11-04', endDate: '2026-11-17', cancelledOn: null };
  const revisions = { A: 1, B: 1 };
  const copy = (over: Partial<LiveSyncCopy> & Pick<LiveSyncCopy, 'id' | 'date' | 'workoutId'>): LiveSyncCopy => ({
    revision: 1,
    customised: false,
    logged: false,
    ...over,
  });

  it('adds wanted days with no copy, from today on only', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [
        { week: 1, day: 1, position: 0, workoutId: 'A' }, // 2026-11-04, past
        { week: 1, day: 3, position: 0, workoutId: 'B' }, // 2026-11-06, today
        { week: 2, day: 1, position: 0, workoutId: 'A' }, // 2026-11-11
      ],
      revisions,
      copies: [],
      today,
    });
    expect(plan.add).toEqual([
      { date: '2026-11-06', workoutId: 'B' },
      { date: '2026-11-11', workoutId: 'A' },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it('removes untouched copies the program no longer has, never past ones', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [],
      revisions,
      copies: [copy({ id: 'past', date: '2026-11-04', workoutId: 'A' }), copy({ id: 'f', date: '2026-11-08', workoutId: 'A' })],
      today,
    });
    expect(plan.remove).toEqual(['f']);
  });

  it('moves a copy when its slot moves (remove old day, add new day)', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [{ week: 2, day: 2, position: 0, workoutId: 'A' }],
      revisions,
      copies: [copy({ id: 'c', date: '2026-11-11', workoutId: 'A' })],
      today,
    });
    expect(plan).toMatchObject({ add: [{ date: '2026-11-12', workoutId: 'A' }], remove: ['c'], replace: [] });
  });

  it('replaces an out-of-date untouched copy, keeping a logged one and reporting a customised one', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [
        { week: 2, day: 1, position: 0, workoutId: 'A' },
        { week: 2, day: 2, position: 0, workoutId: 'A' },
        { week: 2, day: 3, position: 0, workoutId: 'A' },
      ],
      revisions: { A: 2 },
      copies: [
        copy({ id: 'old', date: '2026-11-11', workoutId: 'A' }),
        copy({ id: 'done', date: '2026-11-12', workoutId: 'A', logged: true }),
        copy({ id: 'mine', date: '2026-11-13', workoutId: 'A', customised: true }),
      ],
      today,
    });
    expect(plan).toEqual({ add: [], remove: [], replace: ['old'], skipped: 1 });
  });

  it('treats a copy without a revision (made before Live Sync) as out of date', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      revisions,
      copies: [copy({ id: 'legacy', date: '2026-11-11', workoutId: 'A', revision: null })],
      today,
    });
    expect(plan.replace).toEqual(['legacy']);
  });

  it('keeps protected copies of removed slots and counts only customised ones as skipped', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [],
      revisions,
      copies: [
        copy({ id: 'done', date: '2026-11-08', workoutId: 'A', logged: true }),
        copy({ id: 'mine', date: '2026-11-09', workoutId: 'A', customised: true }),
      ],
      today,
    });
    expect(plan).toEqual({ add: [], remove: [], replace: [], skipped: 1 });
  });

  it('pairs the same workout twice on a day one by one, protected copies first', () => {
    const plan = planLiveSync({
      assignment,
      weeks: 2,
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      revisions,
      copies: [copy({ id: 'plain', date: '2026-11-11', workoutId: 'A' }), copy({ id: 'mine', date: '2026-11-11', workoutId: 'A', customised: true })],
      today,
    });
    expect(plan).toEqual({ add: [], remove: ['plain'], replace: [], skipped: 0 });
  });

  it('ignores slots past the program length and days on or after the cancel date', () => {
    const plan = planLiveSync({
      assignment: { ...assignment, cancelledOn: '2026-11-12' },
      weeks: 2,
      slots: [
        { week: 2, day: 1, position: 0, workoutId: 'A' }, // 11-11: kept
        { week: 2, day: 2, position: 0, workoutId: 'A' }, // 11-12: cancelled
        { week: 3, day: 1, position: 0, workoutId: 'A' }, // past the length
      ],
      revisions,
      copies: [],
      today,
    });
    expect(plan.add).toEqual([{ date: '2026-11-11', workoutId: 'A' }]);
  });

  it('does nothing for an assignment that has ended', () => {
    const plan = planLiveSync({
      assignment: { startDate: '2026-10-01', endDate: '2026-10-14', cancelledOn: null },
      weeks: 2,
      slots: [{ week: 1, day: 1, position: 0, workoutId: 'A' }],
      revisions,
      copies: [],
      today,
    });
    expect(plan).toEqual({ add: [], remove: [], replace: [], skipped: 0 });
  });
});

describe('isLiveWorkout', () => {
  const base = { programLive: true, customised: false, done: false, date: '2026-11-08' };
  it('is true for an untouched, not-done workout of a live program from today on', () => {
    expect(isLiveWorkout(base, today)).toBe(true);
    expect(isLiveWorkout({ ...base, date: today }, today)).toBe(true);
  });
  it('is false for a past, done, customised, or not-live workout', () => {
    expect(isLiveWorkout({ ...base, date: '2026-11-05' }, today)).toBe(false);
    expect(isLiveWorkout({ ...base, done: true }, today)).toBe(false);
    expect(isLiveWorkout({ ...base, customised: true }, today)).toBe(false);
    expect(isLiveWorkout({ ...base, programLive: false }, today)).toBe(false);
  });
});

describe('liveSyncStatus', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  it('says it is off', () => {
    expect(liveSyncStatus({ on: false, clients: 3, syncedAt: null, skipped: 0 }, now)).toBe('Live Sync off');
  });
  it('lists clients, last sync and skipped customised workouts', () => {
    expect(liveSyncStatus({ on: true, clients: 3, syncedAt: '2026-11-06T11:58:00Z', skipped: 1 }, now)).toBe(
      'Live Sync on · 3 clients · last synced 2 min ago · 1 customised workout skipped',
    );
  });
  it('handles one client, nothing skipped, never synced, and just now', () => {
    expect(liveSyncStatus({ on: true, clients: 1, syncedAt: null, skipped: 0 }, now)).toBe('Live Sync on · 1 client · not synced yet');
    expect(liveSyncStatus({ on: true, clients: 0, syncedAt: '2026-11-06T11:59:40Z', skipped: 2 }, now)).toBe(
      'Live Sync on · 0 clients · last synced just now · 2 customised workouts skipped',
    );
  });
  it('uses hours and days for older syncs', () => {
    expect(liveSyncStatus({ on: true, clients: 2, syncedAt: '2026-11-06T09:00:00Z', skipped: 0 }, now)).toBe(
      'Live Sync on · 2 clients · last synced 3 h ago',
    );
    expect(liveSyncStatus({ on: true, clients: 2, syncedAt: '2026-11-04T09:00:00Z', skipped: 0 }, now)).toBe(
      'Live Sync on · 2 clients · last synced 2 days ago',
    );
  });
});
