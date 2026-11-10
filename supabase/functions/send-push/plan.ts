import {
  groupOutbox,
  isEnabled,
  localDateOf,
  nextAllowedTime,
  prefsFromRow,
  pushExpired,
  pushText,
  reminderDue,
  routeFor,
  safeTimeZone,
  type OutboxRowInput,
  type PushData,
  type PushPrefs,
  type PushPrefsRow,
} from '@caltracker/shared';
import type { ApnsPayload } from './apns.ts';

// Pure planning for send-push: what to do with each claimed outbox row, and which daily reminders are due. No I/O.

/** A row is given up after this many failed tries (finish_push_batch holds the same limit). */
export const PUSH_MAX_ATTEMPTS = 5;

const RETRY_MINUTES = [1, 5, 15, 60];

/** How long to wait after the n-th failed try (1–4) before the next. */
export function retryDelayMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 1), RETRY_MINUTES.length) - 1;
  return RETRY_MINUTES[i]! * 60_000;
}

/** An admin's "Send test notification" (public.admin_send_test_push). Not a client-facing type, so not in shared. */
export const TEST_PUSH = {
  title: 'CalTracker',
  body: 'Test notification from CalTracker support',
  route: '/today',
} as const;

type TestRowInput = Omit<OutboxRowInput, 'type'> & { type: 'test' };
export type SenderRow = (OutboxRowInput | TestRowInput) & { attempts: number };

export type UserContext = { prefs: PushPrefs; timeZone: string; badge: number; tokens: string[] };

export type FinishResult = {
  id: string;
  outcome: 'sent' | 'disabled' | 'no_device' | 'expired' | 'failed' | 'retry' | 'defer';
  not_before?: string;
  title?: string;
  body?: string;
  error?: string;
};

/** One notification for one user, to every device they have. collapseId is added by the caller. */
export type PlannedSend = {
  ids: string[];
  groupKey: string;
  /** The highest attempts count among the rows (decides retry or give up). */
  attempts: number;
  tokens: string[];
  payload: Omit<ApnsPayload, 'collapseId'>;
};

/**
 * Per group of rows (same user and group key): invalid data -> failed; type switched off -> disabled; a day-bound
 * type that would land on a later local day (now or after quiet hours) -> expired; inside quiet hours -> deferred to
 * the end of the window; no device -> no_device; otherwise one send with the grouped text.
 */
export function planBatch(
  rows: readonly SenderRow[],
  ctx: ReadonlyMap<string, UserContext>,
  now: Date,
): { results: FinishResult[]; sends: PlannedSend[] } {
  const results: FinishResult[] = [];
  const sends: PlannedSend[] = [];
  const attempts = new Map(rows.map((r) => [r.id, r.attempts]));

  // Test pushes go out at once, one each, whatever the preferences and quiet hours: support is checking delivery.
  const clientRows: (OutboxRowInput & { attempts: number })[] = [];
  for (const r of rows) {
    if (r.type !== 'test') {
      clientRows.push(r);
      continue;
    }
    const user = ctx.get(r.userId);
    if (!user || user.tokens.length === 0) {
      results.push({ id: r.id, outcome: 'no_device' });
      continue;
    }
    sends.push({
      ids: [r.id],
      groupKey: r.groupKey,
      attempts: r.attempts,
      tokens: user.tokens,
      payload: { title: TEST_PUSH.title, body: TEST_PUSH.body, badge: user.badge, route: TEST_PUSH.route, type: 'test' },
    });
  }

  const { groups, invalid } = groupOutbox(clientRows);
  for (const id of invalid) results.push({ id, outcome: 'failed', error: 'invalid data' });

  for (const group of groups) {
    const all = (outcome: FinishResult['outcome'], extra: Partial<FinishResult> = {}) => {
      for (const id of group.ids) results.push({ id, outcome, ...extra });
    };
    const user = ctx.get(group.userId);
    if (user && !isEnabled(user.prefs, group.type)) {
      all('disabled');
      continue;
    }
    if (user) {
      // Sending now or at the end of quiet hours: a day-bound push landing on a later local day is dropped.
      const at = nextAllowedTime(now, user.prefs, user.timeZone);
      if (pushExpired(group.type, new Date(group.createdAt), at, user.timeZone)) {
        all('expired');
        continue;
      }
      if (at.getTime() > now.getTime()) {
        all('defer', { not_before: at.toISOString() });
        continue;
      }
    }
    if (!user || user.tokens.length === 0) {
      all('no_device');
      continue;
    }
    const text = pushText(group);
    sends.push({
      ids: group.ids,
      groupKey: group.groupKey,
      attempts: Math.max(...group.ids.map((id) => attempts.get(id) ?? 0)),
      tokens: user.tokens,
      payload: {
        ...text,
        badge: user.badge,
        route: routeFor(group.type, group.data as PushData[typeof group.type]),
        type: group.type,
      },
    });
  }
  return { results, sends };
}

/** A row of push_reminder_candidates(). */
export type ReminderCandidate = {
  user_id: string;
  workspace_id: string;
  time_zone: string;
  prefs: PushPrefsRow | null;
  workout_id: string;
  workout_name: string;
  workout_count: number;
  last_reminder_at: string | null;
};

export type ReminderRow = {
  user_id: string;
  workspace_id: string;
  type: 'daily_reminder';
  group_key: string;
  data: PushData['daily_reminder'];
};

/** The daily_reminder rows to enqueue now: reminder switched on, reminder time just passed, none yet today. */
export function planReminders(candidates: readonly ReminderCandidate[], now: Date): ReminderRow[] {
  const out: ReminderRow[] = [];
  for (const c of candidates) {
    const prefs = prefsFromRow(c.prefs);
    if (!isEnabled(prefs, 'daily_reminder')) continue;
    const zone = safeTimeZone(c.time_zone);
    const last = c.last_reminder_at ? localDateOf(c.last_reminder_at, zone) : null;
    if (!reminderDue(now, prefs, zone, last)) continue;
    out.push({
      user_id: c.user_id,
      workspace_id: c.workspace_id,
      type: 'daily_reminder',
      group_key: `daily_reminder:${localDateOf(now, zone)}`,
      data: { workoutId: c.workout_id, workoutName: c.workout_name, more: Math.max(c.workout_count - 1, 0) },
    });
  }
  return out;
}
