import { describe, expect, it } from 'vitest';
import {
  INVITE_PLAN_FAR_ERROR,
  INVITE_PLAN_PAST_ERROR,
  InvitePlan,
  invitePlanArgs,
  invitePlanError,
  joinedPlanDay,
} from '../../src/invites/plan';

const P = '11111111-1111-4111-8111-111111111111';
const W1 = '22222222-2222-4222-8222-222222222222';
const W2 = '33333333-3333-4333-8333-333333333333';
const TODAY = '2026-11-07';

describe('InvitePlan', () => {
  it('accepts nothing, a program, or 1 to 7 workouts', () => {
    expect(InvitePlan.safeParse({ kind: 'none' }).success).toBe(true);
    expect(InvitePlan.safeParse({ kind: 'program', programId: P, startOn: '2026-11-09' }).success).toBe(true);
    expect(InvitePlan.safeParse({ kind: 'workouts', items: [{ workoutId: W1, on: '2026-11-09' }] }).success).toBe(true);
    expect(InvitePlan.safeParse({ kind: 'workouts', items: [] }).success).toBe(false);
    const eight = Array.from({ length: 8 }, () => ({ workoutId: W1, on: '2026-11-09' }));
    expect(InvitePlan.safeParse({ kind: 'workouts', items: eight }).success).toBe(false);
  });

  it('rejects bad ids and dates', () => {
    expect(InvitePlan.safeParse({ kind: 'program', programId: 'nope', startOn: '2026-11-09' }).success).toBe(false);
    expect(InvitePlan.safeParse({ kind: 'program', programId: P, startOn: '2026-02-30' }).success).toBe(false);
  });
});

describe('invitePlanError', () => {
  it('allows today up to a year ahead', () => {
    expect(invitePlanError({ kind: 'program', programId: P, startOn: TODAY }, TODAY)).toBeNull();
    expect(invitePlanError({ kind: 'workouts', items: [{ workoutId: W1, on: '2027-11-07' }] }, TODAY)).toBeNull();
    expect(invitePlanError({ kind: 'none' }, TODAY)).toBeNull();
  });

  it('refuses past days and days more than a year ahead', () => {
    expect(invitePlanError({ kind: 'program', programId: P, startOn: '2026-11-06' }, TODAY)).toBe(INVITE_PLAN_PAST_ERROR);
    expect(
      invitePlanError({ kind: 'workouts', items: [{ workoutId: W1, on: TODAY }, { workoutId: W2, on: '2027-11-08' }] }, TODAY),
    ).toBe(INVITE_PLAN_FAR_ERROR);
  });
});

describe('invitePlanArgs', () => {
  it('maps each kind to set_invite_plan arguments', () => {
    expect(invitePlanArgs({ kind: 'program', programId: P, startOn: '2026-11-09' })).toEqual({
      p_program_id: P,
      p_start_on: '2026-11-09',
    });
    expect(
      invitePlanArgs({ kind: 'workouts', items: [{ workoutId: W1, on: '2026-11-09' }, { workoutId: W2, on: '2026-11-11' }] }),
    ).toEqual({ p_workout_ids: [W1, W2], p_workout_days: ['2026-11-09', '2026-11-11'] });
    expect(invitePlanArgs({ kind: 'none' })).toEqual({});
  });
});

describe('joinedPlanDay', () => {
  it('keeps a future day and moves a passed one to the join day', () => {
    expect(joinedPlanDay('2026-11-09', TODAY)).toBe('2026-11-09');
    expect(joinedPlanDay(TODAY, TODAY)).toBe(TODAY);
    expect(joinedPlanDay('2026-11-01', TODAY)).toBe(TODAY);
  });
});
