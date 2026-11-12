/** Every task the app measures (spec: usage analytics, "Tasks"). */
export type TaskName =
  | 'join_from_invite'
  | 'find_todays_workout'
  | 'log_workout'
  | 'log_meal'
  | 'message_coach'
  | 'community_post'
  | 'view_progress'
  | 'coach_first_setup'
  | 'invite_client'
  | 'build_program'
  | 'assign_program'
  | 'review_workout'
  | 'reply_message'
  | 'set_food_targets'
  | 'edit_past_workout';

/** Every custom event the apps may send. PostHog's own `$` events are handled by the SDKs. */
export type EventName =
  | 'task_started'
  | 'task_completed'
  | 'task_abandoned'
  | 'rage_tap'
  | 'error_shown'
  | 'quick_undo'
  | 'slow_screen'
  | 'exercise_search_no_results'
  | 'app_opened'
  | 'notification_opened'
  | 'invite_sent'
  | 'first_workout_logged';

/** The only property keys that may leave the device. Anything else is dropped by `sanitize`. */
export const ALLOWED_KEYS = [
  'task',
  'taps',
  'duration_ms',
  'screens',
  'back_count',
  'error_count',
  'last_screen',
  'variant',
  'sets_logged',
  'taps_per_set',
  'screen',
  'code',
  'item_type',
  'ms',
  'query',
  'kind',
  'role',
  // slow_screen on a first page load: where the time went (see load-timing.ts).
  'server_ms',
  'download_ms',
  'dom_ms',
  'redirect_ms',
  'dns_tcp_ms',
  'nav_type',
] as const;

export type AnalyticsProps = Record<string, string | number | boolean>;
