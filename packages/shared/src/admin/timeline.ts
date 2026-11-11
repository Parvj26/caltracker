import type { EventName, TaskName } from '../analytics/events';
import { isValidServerErrorCode, isValidServerErrorWhere } from '../analytics/server-error';

/** One row on the admin client page's Timeline. `at` is an ISO timestamp. */
export type TimelineEvent = {
  at: string;
  source: 'app' | 'db';
  label: string;
  status?: 'delivered' | 'failed';
};

/** The timeline shows at most this many events. */
export const TIMELINE_LIMIT = 50;

/** Milliseconds since the epoch, or -Infinity for an unreadable time so it sorts last. */
function instant(at: string): number {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Merges DB events with PostHog events: newest first, one copy per (time, label), capped at 50.
 * Times are compared as instants, so `…Z` and `…+13:00` spellings of the same moment match.
 * When PostHog failed (an `Error`), returns the DB events alone with `trackingUnavailable` set.
 */
export function mergeTimeline(
  db: TimelineEvent[],
  posthog: TimelineEvent[] | Error,
): { events: TimelineEvent[]; trackingUnavailable: boolean } {
  const trackingUnavailable = posthog instanceof Error;
  const all = trackingUnavailable ? db : [...db, ...posthog];
  const seen = new Set<string>();
  const unique: TimelineEvent[] = [];
  for (const event of all) {
    const key = `${instant(event.at)}|${event.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }
  const events = unique
    .map((event, index) => ({ event, index, ms: instant(event.at) }))
    .sort((a, b) => (a.ms === b.ms ? a.index - b.index : b.ms > a.ms ? 1 : -1))
    .slice(0, TIMELINE_LIMIT)
    .map(({ event }) => event);
  return { events, trackingUnavailable };
}

/** Plain wording per task: what the person did, and the "-ing" form for an unfinished one. */
const TASK_COPY: Record<TaskName, { done: string; doing: string }> = {
  join_from_invite: { done: 'Joined from an invite', doing: 'joining from an invite' },
  find_todays_workout: { done: "Found today's workout", doing: "finding today's workout" },
  log_workout: { done: 'Logged a workout', doing: 'logging a workout' },
  log_meal: { done: 'Logged a meal', doing: 'logging a meal' },
  message_coach: { done: 'Messaged their coach', doing: 'messaging their coach' },
  community_post: { done: 'Posted in the community', doing: 'posting in the community' },
  view_progress: { done: 'Viewed their progress', doing: 'viewing their progress' },
  coach_first_setup: { done: 'Finished coach setup', doing: 'coach setup' },
  invite_client: { done: 'Invited a client', doing: 'inviting a client' },
  build_program: { done: 'Built a program', doing: 'building a program' },
  assign_program: { done: 'Assigned a program', doing: 'assigning a program' },
  review_workout: { done: 'Reviewed a workout', doing: 'reviewing a workout' },
  reply_message: { done: 'Replied to a message', doing: 'replying to a message' },
  set_food_targets: { done: 'Set food targets', doing: 'setting food targets' },
  edit_past_workout: { done: 'Edited a past workout', doing: 'editing a past workout' },
};

type Props = Record<string, unknown>;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : null;

function taskCopy(props: Props): { done: string; doing: string } | null {
  const task = props.task;
  return typeof task === 'string' && Object.hasOwn(TASK_COPY, task) ? TASK_COPY[task as TaskName] : null;
}

/**
 * One labeller per event in the analytics catalogue (`Record` keeps it complete). Null means
 * noise that stays off the timeline: rage taps, undo, slow screens, task starts, empty searches.
 */
const LABELS: Record<EventName, (props: Props) => string | null> = {
  app_opened: (props) => {
    const version = str(props.$app_version);
    const build = str(props.$app_build);
    if (!version) return 'Opened the app';
    return build ? `Opened the app (${version} build ${build})` : `Opened the app (${version})`;
  },
  notification_opened: () => 'Opened a notification',
  invite_sent: () => 'Sent a client invite',
  first_workout_logged: () => 'Logged their first workout',
  task_completed: (props) => taskCopy(props)?.done ?? null,
  task_abandoned: (props) => {
    const copy = taskCopy(props);
    return copy ? `Didn't finish ${copy.doing}` : null;
  },
  error_shown: (props) => {
    const code = str(props.code);
    return code ? `Saw an error (${code})` : 'Saw an error';
  },
  task_started: () => null,
  rage_tap: () => null,
  quick_undo: () => null,
  slow_screen: () => null,
  exercise_search_no_results: () => null,
};

/**
 * A plain label for a tracked PostHog event, or null when it should not appear on the timeline
 * (noise, PostHog's own `$` events, or anything not in the analytics catalogue).
 */
export function posthogEventLabel(event: string, props: Record<string, unknown>): string | null {
  // Browser `$exception`s are dropped before sending, so any that arrive are server errors. Only the
  // pattern-checked code and where are shown, never other text.
  if (event === '$exception') {
    const { code, where } = props;
    return isValidServerErrorCode(code) && isValidServerErrorWhere(where)
      ? `Server error: ${code} (${where})`
      : 'Server error';
  }
  if (!Object.hasOwn(LABELS, event)) return null;
  return LABELS[event as EventName](props);
}
