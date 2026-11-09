/**
 * The client push notification types (spec docs/superpowers/specs/2026-11-09-client-push-notifications-design.md).
 * The database checks (notification_prefs.disabled, push_outbox.type) list the same keys.
 */
export const PUSH_TYPES = [
  'workout_assigned',
  'workout_changed',
  'daily_reminder',
  'coach_logged',
  'still_training',
  'message',
  'workout_comment',
  'meal_comment',
  'food_targets',
  'community_coach_post',
  'community_activity',
] as const;

export type PushType = (typeof PUSH_TYPES)[number];
/** Types the server sends; still_training is scheduled on the phone. */
export type ServerPushType = Exclude<PushType, 'still_training'>;

export type PushGroup = 'workouts' | 'coach' | 'community';

export type CatalogueEntry = {
  group: PushGroup;
  label: string;
  hint: string;
  defaultOn: true;
  /** False while the feature behind it does not exist yet: the phone leaves its switch out. */
  available: boolean;
};

export const PUSH_GROUP_TITLES: Record<PushGroup, string> = {
  workouts: 'Workouts',
  coach: 'Your coach',
  community: 'Community',
};

const entry = (group: PushGroup, label: string, hint = '', available = true): CatalogueEntry => ({
  group,
  label,
  hint,
  defaultOn: true,
  available,
});

/** Labels and hints as on the approved Notifications settings board. */
export const notificationCatalogue: Record<PushType, CatalogueEntry> = {
  workout_assigned: entry('workouts', 'New workout assigned', 'When your coach adds a workout or program'),
  workout_changed: entry('workouts', 'Today’s workout changed', 'When your coach edits today’s plan'),
  daily_reminder: entry('workouts', 'Daily reminder', 'Only on days with a workout'),
  coach_logged: entry('workouts', 'Coach logged your session', 'Your sticker is waiting'),
  still_training: entry('workouts', 'Still training?', '20 minutes after your last set'),
  message: entry('coach', 'Messages', 'New message from your coach'),
  workout_comment: entry('coach', 'Comments on your workouts'),
  // Meal comments do not exist (coaches reply about a meal by message): no trigger, switch hidden (PO, 2026-11-09).
  meal_comment: entry('coach', 'Comments on your meals', '', false),
  food_targets: entry('coach', 'Food targets changed'),
  community_coach_post: entry('community', 'New coach posts'),
  community_activity: entry('community', 'Reactions and comments', 'Grouped, e.g. “Sam and 4 others”'),
};

export function isPushType(value: unknown): value is PushType {
  return typeof value === 'string' && (PUSH_TYPES as readonly string[]).includes(value);
}
