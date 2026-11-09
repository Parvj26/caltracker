import { z } from 'zod';
import type { ServerPushType } from './catalogue';

export type { ServerPushType } from './catalogue';

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const Name = z.string().max(200);

/**
 * What each outbox row's `data` holds: names and ids only. Message, comment and meal text, body data and weights are
 * never stored, so they can never reach a lock screen. Unknown keys are stripped.
 */
const schemas = {
  workout_assigned: z.object({ actorName: Name, name: Name }),
  workout_changed: z.object({ actorName: Name, workoutId: Uuid, workoutName: Name }),
  daily_reminder: z.object({ workoutId: Uuid, workoutName: Name, more: z.number().int().nonnegative() }),
  coach_logged: z.object({ actorName: Name, logId: Uuid }),
  message: z.object({ actorName: Name, conversationId: Uuid }),
  workout_comment: z.object({ actorName: Name, logId: Uuid, workoutName: Name }),
  meal_comment: z.object({ actorName: Name, mealId: Uuid, mealName: Name }),
  food_targets: z.object({ actorName: Name }),
  community_coach_post: z.object({ actorName: Name, postId: Uuid, communityName: Name }),
  community_activity: z.object({
    actorId: Uuid,
    actorName: Name,
    postId: Uuid,
    activity: z.enum(['reaction', 'comment']),
    notificationId: Uuid,
  }),
} satisfies Record<ServerPushType, z.ZodType>;

/** Per-type data shapes: `PushData['message']`. */
export type PushData = { [T in ServerPushType]: z.infer<(typeof schemas)[T]> };

export function parsePushData<T extends ServerPushType>(type: T, data: unknown): PushData[T] | null {
  const r = schemas[type].safeParse(data);
  return r.success ? (r.data as PushData[T]) : null;
}
