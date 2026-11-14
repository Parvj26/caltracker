import { describe, expect, it } from 'vitest';
import type { HomeLog, HomeWorkout } from '@caltracker/shared';
import { clientToday, relativeDay } from './client-today';
import type { LiveLog } from './home-live';

const COACH = 'coach';
const CLIENT = 'c1';
const TODAY = '2026-11-13';
const NOW = Date.parse('2026-11-13T17:36:00Z');

const workout = (id: string, scheduledOn: string, logs: HomeLog[] = [], name = `Workout ${id}`): HomeWorkout => ({ id, clientId: CLIENT, name, scheduledOn, logs });
const done = (id: string, finishedAt: string): HomeLog => ({ id, status: 'completed', startedAt: finishedAt, finishedAt, lastActivityAt: finishedAt });
const running = (id: string, loggedBy: string): HomeLog => ({ id, status: 'in_progress', startedAt: '2026-11-13T17:12:00Z', finishedAt: null, lastActivityAt: '2026-11-13T17:30:00Z', loggedBy });
const live = (over: Partial<LiveLog> = {}): LiveLog => ({
  id: 'l1',
  clientId: CLIENT,
  name: 'Lower Body Power',
  startedAt: '2026-11-13T17:12:00Z',
  lastActivityAt: '2026-11-13T17:30:00Z',
  done: 11,
  total: 18,
  loggedBy: CLIENT,
  workoutId: 'w1',
  ...over,
});
const input = (workouts: HomeWorkout[], logs: LiveLog[] = []) => ({ clientId: CLIENT, coachId: COACH, today: TODAY, nowMs: NOW, workouts, live: logs });

describe('clientToday', () => {
  it('shows today\'s workout with Log session when nobody has started', () => {
    const t = clientToday(input([workout('w0', '2026-11-12'), workout('w1', TODAY)]));
    expect(t).toMatchObject({ kind: 'planned', workout: { id: 'w1' }, action: { label: 'Log session', href: '/clients/c1/log/w1' }, moreToday: 0 });
  });

  it('shows the client training now with Watch live, ahead of the planned workout', () => {
    const t = clientToday(input([workout('w1', TODAY, [running('l1', CLIENT)])], [live()]));
    expect(t).toMatchObject({ kind: 'live', log: { id: 'l1', done: 11, total: 18 }, minutes: 24, action: { label: 'Watch live', href: '/clients/c1/logs/l1' } });
  });

  it('offers Continue (the logger) when the session in progress is the coach\'s own', () => {
    const t = clientToday(input([workout('w1', TODAY, [running('l1', COACH)])], [live({ loggedBy: COACH })]));
    expect(t).toMatchObject({ kind: 'live', action: { label: 'Continue', href: '/clients/c1/log/w1' } });
  });

  it('agrees with Home when a workout left open long ago blocks today\'s: the planned card offers Watch live', () => {
    // Idle for hours: not "training now", but still in progress, so Log session would be refused.
    const stale = live({ id: 'l9', workoutId: 'w9', lastActivityAt: '2026-11-12T08:00:00Z', startedAt: '2026-11-12T07:00:00Z' });
    const t = clientToday(input([workout('w1', TODAY)], [stale]));
    expect(t).toMatchObject({ kind: 'planned', action: { label: 'Watch live', href: '/clients/c1/logs/l9' } });
  });

  it('picks the first workout not done yet when there are several today, and counts the others', () => {
    const t = clientToday(input([workout('w1', TODAY, [done('d1', '2026-11-13T09:00:00Z')]), workout('w2', TODAY), workout('w3', TODAY)]));
    expect(t).toMatchObject({ kind: 'planned', workout: { id: 'w2' }, moreToday: 2 });
  });

  it('shows a workout already done today with View', () => {
    const t = clientToday(input([workout('w1', TODAY, [done('d1', '2026-11-13T09:00:00Z')])]));
    expect(t).toMatchObject({ kind: 'planned', status: { kind: 'done' }, action: { label: 'View', href: '/clients/c1/logs/d1' } });
  });

  it('says nothing today, with the last workout done and the next one planned', () => {
    const t = clientToday(
      input([
        workout('a', '2026-11-10', [done('d0', '2026-11-10T09:00:00Z')], 'Older'),
        workout('b', '2026-11-12', [done('d1', '2026-11-12T09:00:00Z')], 'Hypertrophy day 12'),
        workout('c', '2026-11-11', [], 'Missed one'),
        workout('d', '2026-11-15', [], 'Hypertrophy day 14'),
        workout('e', '2026-11-17', [], 'Later'),
      ]),
    );
    expect(t).toEqual({ kind: 'nothing', last: { name: 'Hypertrophy day 12', on: '2026-11-12' }, next: { name: 'Hypertrophy day 14', on: '2026-11-15' } });
  });

  it('says nothing today with no last or next when the calendar is empty', () => {
    expect(clientToday(input([]))).toEqual({ kind: 'nothing', last: null, next: null });
  });

  it('ignores another client\'s live workout', () => {
    expect(clientToday(input([], [live({ clientId: 'c2' })])).kind).toBe('nothing');
  });
});

describe('relativeDay', () => {
  it('says yesterday, today and tomorrow, else the short date', () => {
    expect(relativeDay('2026-11-12', TODAY)).toBe('yesterday');
    expect(relativeDay(TODAY, TODAY)).toBe('today');
    expect(relativeDay('2026-11-14', TODAY)).toBe('tomorrow');
    expect(relativeDay('2026-11-15', TODAY)).toBe('Sun 15 Nov');
  });
});
