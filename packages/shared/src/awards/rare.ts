import { STICKERS } from './catalogue';
import type { RareRequirement, StickerDef } from './catalogue';

export type ClientStats = {
  workouts: number;
  streak: number;
  bestStreak: number;
  prCount: number;
  lifetimeVolumeKg: number;
  monthVolumeKg: number;
};

const RARE = STICKERS.filter((s) => s.kind === 'rare');

function met(req: RareRequirement, s: ClientStats): boolean {
  switch (req.kind) {
    case 'workouts':
      return s.workouts >= req.value;
    case 'streak':
      return Math.max(s.streak, s.bestStreak) >= req.value;
    case 'prs':
      return s.prCount >= req.value;
    case 'volume':
      return s.lifetimeVolumeKg >= req.value;
  }
}

/**
 * Rare finds the client now qualifies for and does not own. `before` is accepted for the caller's symmetry
 * but ownership is what prevents repeats, so a find missed earlier is still granted on the next award.
 */
export function newRareFinds(_before: ClientStats, after: ClientStats, owned: ReadonlySet<string>): StickerDef[] {
  return RARE.filter((s) => s.requirement && !owned.has(s.key) && met(s.requirement, after));
}

export function milestoneFor(workoutCount: number): 1 | 10 | 50 | 100 | null {
  return workoutCount === 1 || workoutCount === 10 || workoutCount === 50 || workoutCount === 100 ? workoutCount : null;
}
