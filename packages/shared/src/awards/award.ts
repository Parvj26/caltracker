import type { WorkoutLogDoc } from '../logs/schema';
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

export function computeAward(i: AwardInput): AwardResult {
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

  const drop = qualifying ? rollDrop(i.rng, ownedKeys) : null;

  const rare = newRareFinds(i.statsBefore, i.statsAfter, ownedKeys).map((s) => s.key);

  // A landmark is earned when the streak moves up a week, not by a second workout in the same week.
  const landmarks = i.statsAfter.streak > i.statsBefore.streak ? journeyStep(i.statsAfter.streak).reached : [];

  const milestone = i.statsAfter.workouts > i.statsBefore.workouts ? milestoneFor(i.statsAfter.workouts) : null;

  return {
    ladder,
    drop,
    rare,
    landmarks,
    milestone,
    prs: detectPrs(i.log, i.prHistory, i.firstLogOfExercise),
    volumeKg: Math.round(volumeKg * 1000) / 1000,
  };
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
