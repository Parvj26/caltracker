import { z } from 'zod';
import { addDays, IsoDateSchema } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

/**
 * "Give them something to start with": a program or a few single workouts chosen while inviting a client. Nobody has
 * an account before they join, so the plan is kept with the invite (set_invite_plan) and put on their calendar when
 * they accept it. A day that has passed by then moves to the day they join.
 */

/** Single workouts per invite. */
export const INVITE_PLAN_MAX_WORKOUTS = 7;
/** The furthest ahead a plan may start (the database checks the same). */
export const INVITE_PLAN_MAX_DAYS_AHEAD = 365;

export const InvitePlan = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('program'), programId: z.string().uuid(), startOn: IsoDateSchema }),
  z.object({
    kind: z.literal('workouts'),
    items: z.array(z.object({ workoutId: z.string().uuid(), on: IsoDateSchema })).min(1).max(INVITE_PLAN_MAX_WORKOUTS),
  }),
]);
export type InvitePlan = z.infer<typeof InvitePlan>;

export const INVITE_PLAN_PAST_ERROR = 'Pick today or a later day.';
export const INVITE_PLAN_FAR_ERROR = 'Pick a day within the next year.';

/** Plans start today or later (the client hasn't joined, so nothing can be missed yet) and within a year. */
export function invitePlanError(plan: InvitePlan, today: IsoDate): string | null {
  const days = plan.kind === 'program' ? [plan.startOn] : plan.kind === 'workouts' ? plan.items.map((i) => i.on) : [];
  if (days.some((d) => d < today)) return INVITE_PLAN_PAST_ERROR;
  if (days.some((d) => d > addDays(today, INVITE_PLAN_MAX_DAYS_AHEAD))) return INVITE_PLAN_FAR_ERROR;
  return null;
}

/** set_invite_plan's arguments besides the invite id (left out when unused). "none" clears any plan kept with the invite. */
export function invitePlanArgs(
  plan: InvitePlan,
): { p_program_id?: string; p_start_on?: IsoDate; p_workout_ids?: string[]; p_workout_days?: IsoDate[] } {
  if (plan.kind === 'program') return { p_program_id: plan.programId, p_start_on: plan.startOn };
  if (plan.kind === 'workouts') return { p_workout_ids: plan.items.map((i) => i.workoutId), p_workout_days: plan.items.map((i) => i.on) };
  return {};
}

/** The day a planned item lands on: its own day, or the day they join if that day has already gone by. */
export function joinedPlanDay(planned: IsoDate, joinedOn: IsoDate): IsoDate {
  return planned < joinedOn ? joinedOn : planned;
}
