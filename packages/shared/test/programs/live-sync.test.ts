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
  const hashes = { A: 'a1', B: 'b1' };
  const copy = (over: Partial<LiveSyncCopy> & Pick<LiveSyncCopy, 'id' | 'plannedOn' | 'workoutId'>): LiveSyncCopy => ({
    date: over.plannedOn,
    hash: over.workoutId === 'B' ? 'b1' : 'a1',
    customised: false,
    logged: false,
    ...over,
  });
  const plan = (over: Partial<Parameters<typeof planLiveSync>[0]>) =>
    planLiveSync({ assignment, weeks: 2, slots: [], hashes, copies: [], today, ...over });

  it('adds wanted days with no copy, from today on only', () => {
    const p = plan({
      slots: [
        { week: 1, day: 1, position: 0, workoutId: 'A' }, // 2026-11-04, past
        { week: 1, day: 3, position: 0, workoutId: 'B' }, // 2026-11-06, today
        { week: 2, day: 1, position: 0, workoutId: 'A' }, // 2026-11-11
      ],
    });
    expect(p.add).toEqual([
      { date: '2026-11-06', workoutId: 'B' },
      { date: '2026-11-11', workoutId: 'A' },
    ]);
    expect(p.remove).toEqual([]);
  });

  it('removes untouched copies the program no longer has, only after today', () => {
    const p = plan({
      copies: [
        copy({ id: 'past', plannedOn: '2026-11-04', workoutId: 'A' }),
        copy({ id: 'today', plannedOn: '2026-11-06', workoutId: 'A' }),
        copy({ id: 'f', plannedOn: '2026-11-08', workoutId: 'A' }),
      ],
    });
    expect(p.remove).toEqual(['f']);
  });

  it('moves a copy when its slot moves (remove old day, add new day)', () => {
    const p = plan({
      slots: [{ week: 2, day: 2, position: 0, workoutId: 'A' }],
      copies: [copy({ id: 'c', plannedOn: '2026-11-11', workoutId: 'A' })],
    });
    expect(p).toMatchObject({ add: [{ date: '2026-11-12', workoutId: 'A' }], remove: ['c'], replace: [] });
  });

  it('pairs a copy the coach moved by its program day: no duplicate, nothing skipped', () => {
    const p = plan({
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      copies: [copy({ id: 'moved', plannedOn: '2026-11-11', date: '2026-11-13', workoutId: 'A', customised: true })],
    });
    expect(p).toEqual({ add: [], remove: [], replace: [], skipped: 0 });
  });

  it('refreshes an out-of-date untouched copy, keeps a logged one and reports a customised one', () => {
    const p = plan({
      slots: [
        { week: 2, day: 1, position: 0, workoutId: 'A' },
        { week: 2, day: 2, position: 0, workoutId: 'A' },
        { week: 2, day: 3, position: 0, workoutId: 'A' },
      ],
      hashes: { A: 'a2' },
      copies: [
        copy({ id: 'old', plannedOn: '2026-11-11', workoutId: 'A' }),
        copy({ id: 'done', plannedOn: '2026-11-12', workoutId: 'A', logged: true }),
        copy({ id: 'mine', plannedOn: '2026-11-13', workoutId: 'A', customised: true }),
      ],
    });
    expect(p).toEqual({ add: [], remove: [], replace: ['old'], skipped: 1 });
  });

  it("never refreshes today's copy", () => {
    const p = plan({
      slots: [{ week: 1, day: 3, position: 0, workoutId: 'A' }],
      hashes: { A: 'a2' },
      copies: [copy({ id: 'today', plannedOn: '2026-11-06', workoutId: 'A' })],
    });
    expect(p.replace).toEqual([]);
  });

  it('treats a copy without a hash (made before Live Sync) as out of date', () => {
    const p = plan({
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      copies: [copy({ id: 'legacy', plannedOn: '2026-11-11', workoutId: 'A', hash: null })],
    });
    expect(p.replace).toEqual(['legacy']);
  });

  it('keeps protected copies of removed slots and counts only customised ones as skipped', () => {
    const p = plan({
      copies: [
        copy({ id: 'done', plannedOn: '2026-11-08', workoutId: 'A', logged: true }),
        copy({ id: 'mine', plannedOn: '2026-11-09', workoutId: 'A', customised: true }),
      ],
    });
    expect(p).toEqual({ add: [], remove: [], replace: [], skipped: 1 });
  });

  it('does not add a swapped-in workout on a day whose earlier copy was started or done', () => {
    const p = plan({
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'B' }],
      copies: [copy({ id: 'done', plannedOn: '2026-11-11', workoutId: 'A', logged: true })],
    });
    expect(p).toEqual({ add: [], remove: [], replace: [], skipped: 0 });
  });

  it('does not add a workout on a day the client already worked out', () => {
    const p = plan({
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      busyDays: new Set(['2026-11-11']),
    });
    expect(p.add).toEqual([]);
  });

  it('does not add back a program day the coach deleted', () => {
    const p = plan({
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      tombstones: new Set(['2026-11-11|A']),
    });
    expect(p.add).toEqual([]);
  });

  it('pairs the same workout twice on a day one by one, protected copies first', () => {
    const p = plan({
      slots: [{ week: 2, day: 1, position: 0, workoutId: 'A' }],
      copies: [
        copy({ id: 'plain', plannedOn: '2026-11-11', workoutId: 'A' }),
        copy({ id: 'mine', plannedOn: '2026-11-11', workoutId: 'A', customised: true }),
      ],
    });
    expect(p).toEqual({ add: [], remove: ['plain'], replace: [], skipped: 0 });
  });

  it('ignores slots past the program length and days on or after the cancel date', () => {
    const p = plan({
      assignment: { ...assignment, cancelledOn: '2026-11-12' },
      slots: [
        { week: 2, day: 1, position: 0, workoutId: 'A' }, // 11-11: kept
        { week: 2, day: 2, position: 0, workoutId: 'A' }, // 11-12: cancelled
        { week: 3, day: 1, position: 0, workoutId: 'A' }, // past the length
      ],
    });
    expect(p.add).toEqual([{ date: '2026-11-11', workoutId: 'A' }]);
  });

  it('does nothing for an assignment that has ended', () => {
    const p = plan({
      assignment: { startDate: '2026-10-01', endDate: '2026-10-14', cancelledOn: null },
      slots: [{ week: 1, day: 1, position: 0, workoutId: 'A' }],
    });
    expect(p).toEqual({ add: [], remove: [], replace: [], skipped: 0 });
  });
});

describe('isLiveWorkout', () => {
  const base = { programLive: true, customised: false, started: false, date: '2026-11-08' };
  it('is true for an untouched, not-started workout of a live program after today', () => {
    expect(isLiveWorkout(base, today)).toBe(true);
  });
  it("is false for today's, a past, started or done, customised, or not-live workout", () => {
    expect(isLiveWorkout({ ...base, date: today }, today)).toBe(false);
    expect(isLiveWorkout({ ...base, date: '2026-11-05' }, today)).toBe(false);
    expect(isLiveWorkout({ ...base, started: true }, today)).toBe(false);
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
