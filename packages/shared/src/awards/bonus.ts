import { instantMs } from './ladder';

// At most one bonus sticker per finished workout (product owner, 2026-11-10). Every workout still gets its ladder
// animal. Of the bonuses (a workout-count milestone, a streak landmark, a rare find, a random drop) one is given;
// the others are not lost but wait in the client's queue (award_bonus_queue) and are handed out one per later
// finished workout. A random drop is only rolled when there is nothing else to give, so drops never queue.

export type BonusKind = 'milestone' | 'landmark' | 'rare' | 'drop';

/** One bonus: a milestone carries its workout count (`value`), the others a sticker key. */
export type Bonus = { kind: BonusKind; key: string | null; value: number | null };

/** A bonus waiting to be given: earned by `earnedLogId`, which finished at `earnedAt`. `seq` orders equal times. */
export type QueuedBonus = Bonus & { id: string; earnedLogId: string; earnedAt: string; seq: number };

/** Which bonus goes first when several are due. */
export const BONUS_PRIORITY: readonly BonusKind[] = ['milestone', 'landmark', 'rare', 'drop'];

const rank = (b: Bonus) => BONUS_PRIORITY.indexOf(b.kind);
/** Rare finds and drops are one-of-a-kind stickers: a client owns one at most, so one is never queued twice. */
const oneOff = (b: Bonus) => b.kind === 'rare' || b.kind === 'drop';
const strip = (b: Bonus): Bonus => ({ kind: b.kind, key: b.key, value: b.value });

export type BonusPick = {
  /** The one bonus this workout gives, or null. */
  give: Bonus | null;
  /** The queue row `give` came from, or null when it was earned by this workout (or nothing is given). */
  fromQueue: string | null;
  /** What this workout earned but does not give, highest priority first: it joins the queue. */
  enqueue: Bonus[];
  /** Queue rows no longer due (a rare find the client already owns): removed. */
  discard: string[];
};

/**
 * The bonus a workout gives. `earned` is what this workout earned, highest priority first (planAward builds it);
 * `queue` is the client's waiting bonuses. The highest priority wins; a tie goes to the oldest (a waiting bonus
 * before a new one, then by when it was earned). A waiting bonus is only handed to a workout that finished after
 * the one that earned it, so an old workout awarded late by the catch-up job never takes a later one's bonus.
 */
export function pickBonus(args: {
  earned: readonly Bonus[];
  queue: readonly QueuedBonus[];
  logId: string;
  finishedAt: string;
  owned: ReadonlySet<string>;
}): BonusPick {
  const finished = instantMs(args.finishedAt);
  const discard = args.queue.filter((q) => oneOff(q) && q.key !== null && args.owned.has(q.key)).map((q) => q.id);
  const live = args.queue.filter((q) => !discard.includes(q.id));
  const waitingKeys = new Set(live.filter(oneOff).map((q) => q.key));
  // A milestone number already waiting (its workout was reopened, and the next one reached the same count) is the
  // same milestone: it is not queued a second time.
  const waitingMilestones = new Set(live.filter((q) => q.kind === 'milestone').map((q) => q.value));
  const fresh = args.earned
    .filter((b) => !(oneOff(b) && waitingKeys.has(b.key)) && !(b.kind === 'milestone' && waitingMilestones.has(b.value)))
    .map(strip);

  const due = live
    .filter((q) => q.earnedLogId !== args.logId && instantMs(q.earnedAt) < finished)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || instantMs(a.earnedAt) - instantMs(b.earnedAt) || a.seq - b.seq);
  const oldest = due[0] ?? null;
  const best = [...fresh].sort((a, b) => rank(a) - rank(b))[0] ?? null;

  if (oldest && (!best || rank(oldest) <= rank(best))) {
    return { give: strip(oldest), fromQueue: oldest.id, enqueue: sortByRank(fresh), discard };
  }
  if (best) {
    return { give: best, fromQueue: null, enqueue: sortByRank(fresh.filter((b) => b !== best)), discard };
  }
  return { give: null, fromQueue: null, enqueue: [], discard };
}

/** Stable: equal ranks keep the order they were earned in. */
function sortByRank(bs: readonly Bonus[]): Bonus[] {
  return bs.slice().sort((a, b) => rank(a) - rank(b));
}
