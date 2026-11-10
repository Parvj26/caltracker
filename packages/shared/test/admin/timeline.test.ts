import { describe, expect, it } from 'vitest';
import type { EventName, TaskName } from '../../src/analytics/events';
import { TIMELINE_LIMIT, mergeTimeline, posthogEventLabel, type TimelineEvent } from '../../src/admin/timeline';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 10, minute)).toISOString();
const ev = (minute: number, label: string, source: TimelineEvent['source'] = 'db'): TimelineEvent => ({
  at: at(minute),
  source,
  label,
});

describe('mergeTimeline', () => {
  it('mergeTimeline orders and caps', () => {
    const db = Array.from({ length: 40 }, (_, i) => ev(i, `db ${i}`));
    const app = Array.from({ length: 40 }, (_, i) => ev(i, `app ${i}`, 'app'));
    const { events, trackingUnavailable } = mergeTimeline(db, app);
    expect(trackingUnavailable).toBe(false);
    expect(events).toHaveLength(TIMELINE_LIMIT);
    expect(TIMELINE_LIMIT).toBe(50);
    expect(events[0]!.at).toBe(at(39));
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i - 1]!.at)).toBeGreaterThanOrEqual(Date.parse(events[i]!.at));
    }
    expect(events.at(-1)!.at).toBe(at(15));
  });

  it('orders by instant, not by string, across offsets', () => {
    const db: TimelineEvent[] = [{ at: '2026-11-09T23:30:00+13:00', source: 'db', label: 'Logged a meal' }]; // 10:30Z
    const app: TimelineEvent[] = [{ at: '2026-11-09T10:45:00Z', source: 'app', label: 'Opened the app' }];
    expect(mergeTimeline(db, app).events.map((e) => e.label)).toEqual(['Opened the app', 'Logged a meal']);
  });

  it('deduplicates by time and label, keeping the first (DB) copy', () => {
    const db = [{ ...ev(5, 'Logged a meal'), status: 'delivered' as const }];
    const app: TimelineEvent[] = [
      { at: at(5).replace('.000Z', 'Z'), source: 'app', label: 'Logged a meal' },
      ev(5, 'Opened the app', 'app'),
    ];
    const { events } = mergeTimeline(db, app);
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.label === 'Logged a meal')).toEqual(db[0]);
  });

  it('mergeTimeline with posthog error', () => {
    const db = [ev(1, 'Logged a meal'), ev(3, 'Finished workout')];
    const { events, trackingUnavailable } = mergeTimeline(db, new Error('posthog 401'));
    expect(trackingUnavailable).toBe(true);
    expect(events.map((e) => e.label)).toEqual(['Finished workout', 'Logged a meal']);
  });

  it('handles empty inputs and does not mutate them', () => {
    expect(mergeTimeline([], [])).toEqual({ events: [], trackingUnavailable: false });
    const db = [ev(1, 'a'), ev(2, 'b')];
    mergeTimeline(db, []);
    expect(db.map((e) => e.label)).toEqual(['a', 'b']);
  });

  it('puts events with an unreadable time last', () => {
    const { events } = mergeTimeline([{ at: 'nonsense', source: 'db', label: 'x' }, ev(1, 'y')], []);
    expect(events.map((e) => e.label)).toEqual(['y', 'x']);
  });
});

describe('posthogEventLabel', () => {
  // Every EventName in the analytics catalogue. `satisfies` keeps this list complete.
  const expected = {
    app_opened: 'Opened the app',
    notification_opened: 'Opened a notification',
    invite_sent: 'Sent a client invite',
    first_workout_logged: 'Logged their first workout',
    task_completed: null, // needs a task, see below
    task_abandoned: null,
    error_shown: 'Saw an error',
    task_started: null,
    rage_tap: null,
    quick_undo: null,
    slow_screen: null,
    exercise_search_no_results: null,
  } satisfies Record<EventName, string | null>;

  it('maps every event in the analytics catalogue or returns null', () => {
    for (const [name, label] of Object.entries(expected)) {
      expect(posthogEventLabel(name, {}), name).toBe(label);
    }
  });

  it('adds the app version and build to app_opened', () => {
    expect(posthogEventLabel('app_opened', { $app_version: '1.0.0', $app_build: '2' })).toBe(
      'Opened the app (1.0.0 build 2)',
    );
    expect(posthogEventLabel('app_opened', { $app_version: '1.0.0' })).toBe('Opened the app (1.0.0)');
  });

  it('labels finished and abandoned tasks', () => {
    expect(posthogEventLabel('task_completed', { task: 'log_meal' })).toBe('Logged a meal');
    expect(posthogEventLabel('task_completed', { task: 'log_workout' })).toBe('Logged a workout');
    expect(posthogEventLabel('task_abandoned', { task: 'log_meal' })).toBe("Didn't finish logging a meal");
    expect(posthogEventLabel('task_completed', { task: 'nope' })).toBeNull();
  });

  it('has a label for every task', () => {
    const tasks: Record<TaskName, true> = {
      join_from_invite: true, find_todays_workout: true, log_workout: true, log_meal: true, message_coach: true,
      community_post: true, view_progress: true, coach_first_setup: true, invite_client: true, build_program: true,
      assign_program: true, review_workout: true, reply_message: true, set_food_targets: true, edit_past_workout: true,
    };
    for (const task of Object.keys(tasks)) {
      expect(posthogEventLabel('task_completed', { task }), task).toMatch(/^[A-Z]/);
      expect(posthogEventLabel('task_abandoned', { task }), task).toMatch(/^Didn't finish [a-z]/);
    }
  });

  it('adds the error code to error_shown', () => {
    expect(posthogEventLabel('error_shown', { code: 'network' })).toBe('Saw an error (network)');
  });

  it('returns null for unknown and PostHog $ events', () => {
    expect(posthogEventLabel('$pageview', {})).toBeNull();
    expect(posthogEventLabel('$exception', {})).toBeNull();
    expect(posthogEventLabel('something_else', {})).toBeNull();
  });
});
