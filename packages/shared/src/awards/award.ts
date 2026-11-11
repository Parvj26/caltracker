import type { WorkoutLogDoc } from '../logs/schema';
import { pickBonus } from './bonus';
import type { Bonus, QueuedBonus } from './bonus';
import { logVolumeKg } from '../logs/summary';
import { journeyStep } from './streak';
import { isQualifying, pickLadderAnimal } from './ladder';
import { detectPrs } from './prs';
import type { PersonalRecord } from './prs';
import { milestoneFor, newRareFinds } from './rare';
import type { ClientStats } from './rare';
import { rollDrop, rollShiny } from './rolls';
import type { Rng } from './rolls';

export type AwardInput = {
  log: WorkoutLogDoc;
  owned: Map<string, { count: number; shiny: boolean }>;
  prHistory: PersonalRecord[];
  firstLogOfExercise: ReadonlySet<string>;
  statsBefore: ClientStats;
  statsAfter: ClientStats;
  rng: Rng;
  /** The ladder animals awarded for logs finished before this one, oldest first (ladderHistoryBefore). */
  ladderHistory: readonly string[];
  /** The animal already stored for this log: a workout keeps it forever, whatever the volume becomes. */
  keepLadder?: string | null;
  /** The client's bonuses still waiting to be given (award_bonus_queue). None: an empty queue. */
  bonusQueue?: readonly QueuedBonus[];
};

export type AwardResult = {
  ladder: { key: string; multiple: number; isNew: boolean; count: number; shiny: boolean } | null;
  drop: string | null;
  rare: string[];
  landmarks: string[];
  milestone: number | null;
  prs: PersonalRecord[];
  /**
   * The workout's volume (logVolumeKg) when it was awarded, to 3 decimals. Stored with the award so a shared workout
   * card can say how much was lifted without the database adding anything up. Awards stored before 2026-11-07 have
   * none.
   */
  volumeKg?: number;
};

/** The award, plus what it does to the client's bonus queue (see bonus.ts). */
export type AwardPlan = {
  award: AwardResult;
  /** The queue row this award hands out, to remove; null when the bonus (if any) was earned by this workout. */
  fromQueue: string | null;
  /** Bonuses this workout earned but does not give, highest priority first: added to the queue. */
  enqueue: Bonus[];
  /** Queue rows no longer due (already owned): removed. */
  discard: string[];
};

/**
 * What a finished workout earns: its ladder animal, and at most one bonus sticker (milestone, then streak landmark,
 * then rare find, then random drop; a waiting one counts too, see pickBonus). A drop is only rolled when there is
 * nothing else to give. The stored result keeps its shape: `rare` and `landmarks` hold one key at most.
 */
export function planAward(i: AwardInput): AwardPlan {
  const qualifying = isQualifying(i.log);
  const ownedKeys = new Set(i.owned.keys());

  let ladder: AwardResult['ladder'] = null;
  const volumeKg = logVolumeKg(i.log);
  const animal = pickLadderAnimal(volumeKg, i.ladderHistory, i.log.id, i.keepLadder);
  if (animal) {
    const prev = i.owned.get(animal.sticker.key);
    const shiny = (prev?.shiny ?? false) || (qualifying && rollShiny(i.rng));
    ladder = {
      key: animal.sticker.key,
      multiple: animal.multiple,
      isNew: !prev,
      count: (prev?.count ?? 0) + 1,
      shiny,
    };
  }

  const earned: Bonus[] = [];
  const milestone = i.statsAfter.workouts > i.statsBefore.workouts ? milestoneFor(i.statsAfter.workouts) : null;
  if (milestone !== null) earned.push({ kind: 'milestone', key: null, value: milestone });
  // A landmark is earned when the streak moves up a week, not by a second workout in the same week.
  const landmarks = i.statsAfter.streak > i.statsBefore.streak ? journeyStep(i.statsAfter.streak).reached : [];
  for (const key of landmarks) earned.push({ kind: 'landmark', key, value: null });
  for (const s of newRareFinds(i.statsBefore, i.statsAfter, ownedKeys)) earned.push({ kind: 'rare', key: s.key, value: null });

  const pick = pickBonus({
    earned,
    queue: i.bonusQueue ?? [],
    logId: i.log.id,
    finishedAt: i.log.finishedAt ?? '',
    owned: ownedKeys,
  });
  let give = pick.give;
  if (!give && qualifying) {
    const drop = rollDrop(i.rng, ownedKeys);
    if (drop) give = { kind: 'drop', key: drop, value: null };
  }
  const keyOf = (kind: Bonus['kind']) => (give?.kind === kind && give.key !== null ? [give.key] : []);

  return {
    award: {
      ladder,
      drop: keyOf('drop')[0] ?? null,
      rare: keyOf('rare'),
      landmarks: keyOf('landmark'),
      milestone: give?.kind === 'milestone' ? give.value : null,
      prs: detectPrs(i.log, i.prHistory, i.firstLogOfExercise),
      volumeKg: Math.round(volumeKg * 1000) / 1000,
    },
    fromQueue: pick.fromQueue,
    enqueue: pick.enqueue,
    discard: pick.discard,
  };
}

/** The award alone (planAward without the queue changes). */
export function computeAward(i: AwardInput): AwardResult {
  return planAward(i).award;
}

export type RevealCard = {
  type: 'ladder' | 'drop' | 'rare' | 'landmark' | 'milestone';
  key?: string;
  value?: number;
};

/** The reveal cards in the order they are shown: ladder, drop, rare finds, landmarks, milestone. */
export function revealCards(r: AwardResult): RevealCard[] {
  const cards: RevealCard[] = [];
  if (r.ladder) cards.push({ type: 'ladder', key: r.ladder.key, value: r.ladder.multiple });
  if (r.drop) cards.push({ type: 'drop', key: r.drop });
  for (const key of r.rare) cards.push({ type: 'rare', key });
  for (const key of r.landmarks) cards.push({ type: 'landmark', key });
  if (r.milestone !== null) cards.push({ type: 'milestone', value: r.milestone });
  return cards;
}
