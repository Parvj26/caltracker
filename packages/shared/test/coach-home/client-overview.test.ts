import { describe, expect, it } from 'vitest';
import { ageLabel, latestUpdates, trainingSummary } from '../../src/coach-home/client-overview';
import type { ClientUpdate } from '../../src/coach-home/client-overview';
import type { HomeLog, HomeWorkout } from '../../src/coach-home/home';

let n = 0;
const done: HomeLog = {
  id: 'l',
  status: 'completed',
  startedAt: '2026-11-01T10:00:00Z',
  finishedAt: '2026-11-01T10:30:00Z',
  lastActivityAt: '2026-11-01T10:30:00Z',
};
function w(scheduledOn: string, isDone = false, logs?: HomeLog[]): HomeWorkout {
  n += 1;
  return { id: `w${n}`, clientId: 'c', name: 'Upper', scheduledOn, logs: logs ?? (isDone ? [done] : []) };
}

// Friday 6 November 2026. Next week is Mon 9 to Sun 15 November.
const today = '2026-11-06';

describe('trainingSummary', () => {
  it('counts planned and done in the last 7 days (6 days ago up to today)', () => {
    const s = trainingSummary([w('2026-10-30', true), w('2026-10-31', true), w('2026-11-02'), w('2026-11-05', true), w('2026-10-29', true)], [], today);
    // 6 days before Fri 6 Nov is Sat 31 Oct: 29 and 30 Oct are outside.
    expect(s.last7).toEqual({ tracked: 2, planned: 3, added: 0 });
  });

  it('counts today only once it is done', () => {
    expect(trainingSummary([w(today)], [], today).last7).toEqual({ tracked: 0, planned: 0, added: 0 });
    expect(trainingSummary([w(today, true)], [], today).last7).toEqual({ tracked: 1, planned: 1, added: 0 });
  });

  it('ignores a discarded or in-progress log', () => {
    const s = trainingSummary(
      [w('2026-11-04', false, [{ ...done, status: 'discarded' }]), w('2026-11-05', false, [{ ...done, status: 'in_progress', finishedAt: null }])],
      [],
      today,
    );
    expect(s.last7).toEqual({ tracked: 0, planned: 2, added: 0 });
  });

  it('counts the last 30 days from 29 days ago', () => {
    const s = trainingSummary([w('2026-10-08', true), w('2026-10-07', true), w('2026-10-20'), w('2026-11-06', true)], [], today);
    expect(s.last30).toEqual({ tracked: 2, planned: 3, added: 0 });
  });

  it('reports workouts the client added themselves separately', () => {
    const s = trainingSummary([w('2026-11-03', true)], ['2026-11-01', '2026-11-06', '2026-10-20', '2026-10-01', '2026-11-07'], today);
    expect(s.last7).toEqual({ tracked: 1, planned: 1, added: 2 });
    expect(s.last30.added).toBe(3);
  });

  it('counts next week Monday to Sunday', () => {
    const s = trainingSummary([w('2026-11-08'), w('2026-11-09'), w('2026-11-12'), w('2026-11-15'), w('2026-11-16')], [], today);
    expect(s.nextWeek).toBe(3);
  });

  it('on a Sunday, next week is the one starting tomorrow', () => {
    expect(trainingSummary([w('2026-11-09'), w('2026-11-08')], [], '2026-11-08').nextWeek).toBe(1);
  });

  it('is all zeros with nothing planned', () => {
    expect(trainingSummary([], [], today)).toEqual({
      last7: { tracked: 0, planned: 0, added: 0 },
      last30: { tracked: 0, planned: 0, added: 0 },
      nextWeek: 0,
    });
  });
});

describe('ageLabel', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  it.each([
    ['2026-11-06T11:59:40Z', 'now'],
    ['2026-11-06T11:55:00Z', '5m'],
    ['2026-11-06T09:00:00Z', '3h'],
    ['2026-11-05T11:00:00Z', '1d'],
    ['2026-10-31T12:00:00Z', '6d'],
    ['2026-10-23T12:00:00Z', '2w'],
    ['2025-11-01T12:00:00Z', '1y'],
    ['2026-11-06T12:05:00Z', 'now'],
  ])('%s is %s', (iso, label) => {
    expect(ageLabel(iso, now)).toBe(label);
  });
});

describe('latestUpdates', () => {
  const u = (id: string, at: string): ClientUpdate => ({ id, kind: 'workout', at, text: id });
  it('sorts newest first, breaks ties by id, and keeps the limit', () => {
    const list = [u('a', '2026-11-01T10:00:00Z'), u('c', '2026-11-03T10:00:00Z'), u('b', '2026-11-03T10:00:00Z'), u('d', '2026-10-01T10:00:00Z')];
    expect(latestUpdates(list, 3).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('does not change its input', () => {
    const list = [u('a', '2026-11-01T10:00:00Z'), u('b', '2026-11-02T10:00:00Z')];
    latestUpdates(list, 8);
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
