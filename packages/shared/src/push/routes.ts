import type { PushData, ServerPushType } from './data';

/** The in-app route a tapped notification opens (expo-router paths). */
export function routeFor<T extends ServerPushType>(type: T, data: PushData[T]): string {
  // The switch narrows `type`, not `data`; each branch reads only its own type's fields.
  const d = data as Record<string, unknown>;
  switch (type) {
    case 'workout_assigned':
      return '/workouts';
    case 'workout_changed':
      return `/workout/${String(d.workoutId)}`;
    case 'daily_reminder':
      return '/today';
    case 'coach_logged':
    case 'workout_comment':
      return `/log/${String(d.logId)}/summary`;
    case 'message':
      return '/coach';
    case 'meal_comment':
    case 'food_targets':
      return '/food';
    case 'community_coach_post':
    case 'community_activity':
      return `/community/${String(d.postId)}`;
  }
  return '/today';
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp(`^(?:/(?:today|workouts|coach|food)|/(?:workout|community)/${UUID}|/log/${UUID}/summary)$`, 'i');

/** Only routes routeFor can produce: a tapped notification never opens anything else. */
export function isPushRoute(route: unknown): route is string {
  return typeof route === 'string' && ROUTE.test(route);
}
