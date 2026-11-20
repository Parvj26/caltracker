/**
 * How an exercise's logged weight reads (product owner, 2026-11-19):
 * - `weight`: the weight lifted (a barbell squat).
 * - `added`: weight added to the body (a weighted pull-up or dip): "+7.5 kg". Bodyweight alone is not logged as a
 *   counted lift, so only the added part is compared, and no 1-rep max is estimated (it would need the body weight).
 * - `assisted`: help from a machine or band (an assisted pull-up): "20 kg assist". LESS is better, so the best set
 *   is the one with the least help, and no 1-rep max is estimated.
 * Used by personal records (prs.ts) and the Strength screens (progress/heaviest.ts), so both read lifts the same way.
 */
export type LoadStyle = 'weight' | 'added' | 'assisted';

const ASSISTED = /\bassist(ed|ance)?\b/i;
const MACHINE = /\bmachine\b/i;
const BODYWEIGHT = /\b(pull|chin|push|muscle)[\s-]?ups?\b|\bdips?\b|\binverted rows?\b|\bbody ?weight\b|\bpistol squats?\b|\bnordic\b|\bhanging leg raises?\b|\bback extensions?\b/i;

/** The load style for an exercise from its name (logs keep no equipment). An unknown name is plain `weight`. */
export function loadStyleOf(name: string): LoadStyle {
  if (ASSISTED.test(name)) return 'assisted';
  // A machine version (Dip Machine, Back Extension Machine) loads a stack, not the body.
  if (MACHINE.test(name)) return 'weight';
  if (BODYWEIGHT.test(name)) return 'added';
  return 'weight';
}

/** Sets with more reps than this give no estimated 1-rep max: the estimate stops meaning much past ~12 reps. */
export const E1RM_MAX_REPS = 12;
