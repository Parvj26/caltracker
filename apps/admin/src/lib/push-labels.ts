import type { TimelineEvent } from '@caltracker/shared';
import type { PillTone } from '@/components/pill';

/** Plain words for each push_outbox type. */
export const PUSH_TYPES: Record<string, string> = {
  workout_assigned: 'Workout assigned',
  workout_changed: 'Workout changed',
  daily_reminder: 'Daily reminder',
  coach_logged: 'Coach logged a workout',
  message: 'New message',
  workout_comment: 'Workout comment',
  meal_comment: 'Meal comment',
  food_targets: 'Food targets',
  community_coach_post: 'Community post from the coach',
  community_activity: 'Community activity',
  test: 'Test notification',
};

export const pushType = (type: string) => PUSH_TYPES[type] ?? type;

/**
 * Every push_outbox outcome (see 20261109000100_push_tables.sql). Null = not sent yet.
 * expired = it could not go out the same day (quiet hours), so it was dropped. A dead phone token shows as no_device.
 */
export const PUSH_OUTCOMES: Record<string, { label: string; tone: PillTone }> = {
  sent: { label: 'Sent', tone: 'lime' },
  disabled: { label: 'Turned off', tone: 'grey' },
  no_device: { label: 'No phone', tone: 'tape' },
  expired: { label: 'Expired', tone: 'grey' },
  failed: { label: 'Failed', tone: 'tape' },
};

export function pushOutcome(outcome: string | null | undefined): { label: string; tone: PillTone } {
  if (!outcome) return { label: 'Waiting', tone: 'blue' };
  return PUSH_OUTCOMES[outcome] ?? { label: outcome, tone: 'grey' };
}

/** One push on the client page's Timeline: "Delivered" only when it was really sent. */
export function pushTimelineEvent(p: { at: string; sent_at: string | null; type: string; outcome: string | null }): TimelineEvent {
  const type = pushType(p.type);
  const at = p.sent_at ?? p.at;
  switch (p.outcome) {
    case 'sent':
      return { at, source: 'db', label: `Notification sent · ${type}`, status: 'delivered' };
    case 'failed':
      return { at, source: 'db', label: `Notification failed · ${type}`, status: 'failed' };
    case 'no_device':
      return { at, source: 'db', label: `Notification not sent: no phone · ${type}`, status: 'failed' };
    case 'expired':
      return { at, source: 'db', label: `Notification not sent: expired · ${type}` };
    case 'disabled':
      return { at, source: 'db', label: `Notification not sent: turned off · ${type}` };
    default:
      return { at, source: 'db', label: `Notification waiting · ${type}` };
  }
}

/** The line under a "Recent errors" entry. */
export function pushErrorText(e: { outcome: string | null; error: string | null }): string {
  if (e.outcome === 'no_device') return 'No phone registered';
  if (e.outcome === 'expired') return 'Expired before it could send (quiet hours)';
  return e.error ? `Failed: ${e.error}` : 'Failed';
}
