import { assertEquals } from '@std/assert';
import { DEFAULT_PUSH_PREFS, type PushPrefs } from '@caltracker/shared';
import {
  PUSH_MAX_ATTEMPTS,
  planBatch,
  planReminders,
  retryDelayMs,
  type ReminderCandidate,
  type SenderRow,
  type UserContext,
} from './plan.ts';

const U = '11111111-1111-4111-8111-111111111111';
const POST = '22222222-2222-4222-8222-222222222222';
const WORKOUT = '33333333-3333-4333-8333-333333333333';
const CONV = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'a'.repeat(64);

const ctx = (over: Partial<UserContext> = {}, prefs: Partial<PushPrefs> = {}) =>
  new Map<string, UserContext>([
    [U, { prefs: { ...DEFAULT_PUSH_PREFS, ...prefs }, timeZone: 'UTC', badge: 2, tokens: [TOKEN], ...over }],
  ]);

let n = 0;
const row = (over: Partial<SenderRow> = {}): SenderRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  userId: U,
  type: 'message',
  groupKey: `message:${CONV}`,
  data: { actorName: 'Luis', conversationId: CONV },
  createdAt: '2026-11-09T12:00:00.000Z',
  attempts: 0,
  ...over,
});

const noon = new Date('2026-11-09T12:01:00.000Z');
const night = new Date('2026-11-09T23:00:00.000Z');

Deno.test('a due message becomes one send with text, route and badge', () => {
  const r = row();
  const { results, sends } = planBatch([r], ctx(), noon);
  assertEquals(results, []);
  assertEquals(sends, [
    {
      ids: [r.id],
      groupKey: r.groupKey,
      attempts: 0,
      tokens: [TOKEN],
      payload: {
        title: 'Message from Luis',
        body: 'Luis sent you a message.',
        badge: 2,
        route: '/coach',
        type: 'message',
      },
    },
  ]);
});

Deno.test('invalid data fails', () => {
  const r = row({ data: { actorName: 'Luis' } });
  assertEquals(planBatch([r], ctx(), noon).results, [{ id: r.id, outcome: 'failed', error: 'invalid data' }]);
});

Deno.test('disabled type is dropped', () => {
  const r = row();
  const { results, sends } = planBatch([r], ctx({}, { disabled: ['message'] }), noon);
  assertEquals(results, [{ id: r.id, outcome: 'disabled' }]);
  assertEquals(sends, []);
});

Deno.test('quiet hours defer to 07:00 local', () => {
  const r = row({ createdAt: night.toISOString() });
  assertEquals(planBatch([r], ctx(), night).results, [
    { id: r.id, outcome: 'defer', not_before: '2026-11-10T07:00:00.000Z' },
  ]);
});

Deno.test('quiet hours use the client time zone', () => {
  // 23:00 UTC is 18:00 in New York: not quiet.
  const r = row({ createdAt: night.toISOString() });
  assertEquals(planBatch([r], ctx({ timeZone: 'America/New_York' }), night).sends.length, 1);
});

Deno.test('quiet hours off sends at night', () => {
  const r = row({ createdAt: night.toISOString() });
  assertEquals(planBatch([r], ctx({}, { quietEnabled: false }), night).sends.length, 1);
});

Deno.test('workout_changed pushed past midnight expires', () => {
  const r = row({
    type: 'workout_changed',
    groupKey: `workout_changed:${WORKOUT}`,
    data: { actorName: 'Luis', workoutId: WORKOUT, workoutName: 'Upper A' },
    createdAt: night.toISOString(),
  });
  assertEquals(planBatch([r], ctx(), night).results, [{ id: r.id, outcome: 'expired' }]);
});

Deno.test('no devices', () => {
  const r = row();
  assertEquals(planBatch([r], ctx({ tokens: [] }), noon).results, [{ id: r.id, outcome: 'no_device' }]);
});

Deno.test('a user without context has no device', () => {
  const r = row();
  assertEquals(planBatch([r], new Map(), noon).results, [{ id: r.id, outcome: 'no_device' }]);
});

Deno.test('community rows group into one send with grouped text', () => {
  const sam = '55555555-5555-4555-8555-555555555555';
  const kim = '66666666-6666-4666-8666-666666666666';
  const base = { type: 'community_activity' as const, groupKey: `community_activity:reaction:${POST}` };
  const a = row({ ...base, data: { actorId: sam, actorName: 'Sam', postId: POST, activity: 'reaction', notificationId: sam }, createdAt: '2026-11-09T11:00:00.000Z' });
  const b = row({ ...base, data: { actorId: kim, actorName: 'Kim', postId: POST, activity: 'reaction', notificationId: kim }, attempts: 2 });
  const { sends } = planBatch([b, a], ctx(), noon);
  assertEquals(sends.length, 1);
  assertEquals(sends[0]!.ids, [a.id, b.id]);
  assertEquals(sends[0]!.attempts, 2);
  assertEquals(sends[0]!.payload.body, 'Sam and 1 other reacted to your post.');
  assertEquals(sends[0]!.payload.route, `/community/${POST}`);
});

Deno.test('retryDelayMs', () => {
  assertEquals([1, 2, 3, 4].map(retryDelayMs), [60_000, 300_000, 900_000, 3_600_000]);
  assertEquals(PUSH_MAX_ATTEMPTS, 5);
});

const candidate = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  user_id: U,
  workspace_id: '77777777-7777-4777-8777-777777777777',
  time_zone: 'America/New_York',
  prefs: null,
  workout_id: WORKOUT,
  workout_name: 'Upper A',
  workout_count: 2,
  last_reminder_at: null,
  ...over,
});
// 08:05 in New York (EST, UTC-5).
const eightOhFive = new Date('2026-11-09T13:05:00.000Z');

Deno.test('planReminders: due at the reminder time in the client zone', () => {
  assertEquals(planReminders([candidate()], eightOhFive), [
    {
      user_id: U,
      workspace_id: '77777777-7777-4777-8777-777777777777',
      type: 'daily_reminder',
      group_key: 'daily_reminder:2026-11-09',
      data: { workoutId: WORKOUT, workoutName: 'Upper A', more: 1 },
    },
  ]);
});

Deno.test('planReminders: not before the time, not twice a day, not when switched off', () => {
  assertEquals(planReminders([candidate()], new Date('2026-11-09T12:55:00.000Z')), []);
  assertEquals(planReminders([candidate({ last_reminder_at: '2026-11-09T13:00:00.000Z' })], eightOhFive), []);
  const off = { disabled: ['daily_reminder'], reminder_time: '08:00:00', quiet_enabled: true, quiet_start: '22:00:00', quiet_end: '07:00:00' };
  assertEquals(planReminders([candidate({ prefs: off })], eightOhFive), []);
  const later = { ...off, disabled: [], reminder_time: '09:30:00' };
  assertEquals(planReminders([candidate({ prefs: later })], eightOhFive), []);
});

Deno.test('a day-bound push still waiting on a later day expires (e.g. after an outage or retries)', () => {
  const r = row({
    type: 'workout_changed',
    groupKey: `workout_changed:${WORKOUT}`,
    data: { actorName: 'Luis', workoutId: WORKOUT, workoutName: 'Upper A' },
    createdAt: '2026-11-08T15:00:00.000Z',
  });
  assertEquals(planBatch([r], ctx(), noon).results, [{ id: r.id, outcome: 'expired' }]);
  // A message from yesterday is still worth sending.
  const m = row({ createdAt: '2026-11-08T15:00:00.000Z' });
  assertEquals(planBatch([m], ctx(), noon).sends.length, 1);
});
