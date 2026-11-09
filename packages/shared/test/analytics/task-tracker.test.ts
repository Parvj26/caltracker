import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalyticsProps, EventName } from '../../src/analytics/events';
import { TaskTracker } from '../../src/analytics/task-tracker';
import { RageTapDetector } from '../../src/analytics/rage-tap';
import { isQuickUndo } from '../../src/analytics/quick-undo';

let t = 0;
const now = () => t;
let sent: Array<[EventName, AnalyticsProps]>;
let tracker: TaskTracker;

beforeEach(() => {
  t = 0;
  sent = [];
  tracker = new TaskTracker((e, p) => sent.push([e, p]), now);
});

describe('TaskTracker', () => {
  it('reports taps, backs, screens, errors and time on completion', () => {
    tracker.start('log_meal');
    tracker.tap(); tracker.tap(); tracker.tap();
    tracker.back();
    tracker.screen('food'); tracker.screen('food/new');
    tracker.error();
    t = 4000;
    tracker.complete('log_meal');
    expect(sent).toEqual([
      ['task_started', { task: 'log_meal' }],
      ['task_completed', { task: 'log_meal', taps: 3, back_count: 1, screens: 2, error_count: 1, duration_ms: 4000 }],
    ]);
  });

  it('adds sets_logged and taps_per_set for workouts', () => {
    tracker.start('log_workout');
    for (let i = 0; i < 18; i++) tracker.tap();
    tracker.complete('log_workout', { sets_logged: 6 });
    expect(sent[1]![1]).toMatchObject({ sets_logged: 6, taps_per_set: 3 });
  });

  it('carries the variant', () => {
    tracker.start('log_meal', 'photo');
    tracker.complete('log_meal');
    expect(sent[1]![1]).toMatchObject({ variant: 'photo' });
  });

  it('ignores completing a task that was never started', () => {
    tracker.complete('log_meal');
    expect(sent).toEqual([]);
  });

  it('ignores a second start of an open task', () => {
    tracker.start('log_meal');
    tracker.tap();
    tracker.start('log_meal');
    tracker.complete('log_meal');
    expect(sent.filter(([e]) => e === 'task_started')).toHaveLength(1);
    expect(sent.at(-1)![1]).toMatchObject({ taps: 1 });
  });

  it('counts taps in every open task', () => {
    tracker.start('log_meal');
    tracker.start('message_coach');
    tracker.tap();
    tracker.complete('log_meal');
    tracker.complete('message_coach');
    expect(sent.filter(([e]) => e === 'task_completed').map(([, p]) => p.taps)).toEqual([1, 1]);
  });

  it('abandons open tasks after more than 10 minutes in the background', () => {
    tracker.start('log_workout');
    tracker.screen('log');
    tracker.backgrounded();
    t = 600_001;
    tracker.foregrounded();
    expect(sent.at(-1)).toEqual(['task_abandoned', expect.objectContaining({ task: 'log_workout', last_screen: 'log' })]);
    tracker.complete('log_workout');
    expect(sent.at(-1)![0]).toBe('task_abandoned');
  });

  it('keeps tasks open after a short background', () => {
    tracker.start('log_workout');
    tracker.backgrounded();
    t = 599_999;
    tracker.foregrounded();
    expect(sent).toHaveLength(1);
  });

  it('abandon reports the last screen', () => {
    tracker.start('invite_client');
    tracker.screen('clients');
    tracker.abandon('invite_client');
    expect(sent.at(-1)).toEqual(['task_abandoned', expect.objectContaining({ task: 'invite_client', last_screen: 'clients' })]);
  });

  it('clear drops open tasks silently', () => {
    tracker.start('log_meal');
    tracker.clear();
    tracker.complete('log_meal');
    expect(sent).toHaveLength(1);
  });
});

describe('RageTapDetector', () => {
  it('fires on the third tap within one second', () => {
    const d = new RageTapDetector(now);
    t = 0; expect(d.tap('a')).toBe(false);
    t = 300; expect(d.tap('a')).toBe(false);
    t = 900; expect(d.tap('a')).toBe(true);
  });
  it('does not fire when taps are spread out or on different elements', () => {
    const d = new RageTapDetector(now);
    for (const ms of [0, 600, 1200]) { t = ms; expect(d.tap('a')).toBe(false); }
    const e = new RageTapDetector(now);
    expect([e.tap('a'), e.tap('b'), e.tap('a')]).toEqual([false, false, false]);
  });
});

describe('isQuickUndo', () => {
  it('is true within 30 seconds', () => {
    expect(isQuickUndo(0, 30_000)).toBe(true);
    expect(isQuickUndo(0, 30_001)).toBe(false);
  });
});
