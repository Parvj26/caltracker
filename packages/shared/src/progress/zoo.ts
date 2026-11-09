import { STICKERS } from '../awards/catalogue';
import { animalAmount } from '../awards/ladder';
import { formatTotalWeight } from '../units/units';
import type { Units } from '../units/units';

const LADDER = STICKERS.filter((s) => s.kind === 'ladder').sort((a, b) => (a.weightKg ?? 0) - (b.weightKg ?? 0));

/**
 * Everything lifted so far next to the heaviest ladder animal it outweighs, in the app's community-card words
 * ("about as much as 23 elephants"). Null under the lightest animal.
 */
export function lifetimeAnimalLine(volumeKg: number): string | null {
  const animal = [...LADDER].reverse().find((s) => (s.weightKg ?? Infinity) <= volumeKg);
  if (!animal?.weightKg || volumeKg <= 0) return null;
  const a = animalAmount(volumeKg / animal.weightKg, animal.name);
  return `about as much as ${a.count} ${a.noun.toLowerCase()}`;
}

/** The Zoo book tile on Progress: stickers collected and the lifetime volume as animals. */
export function zooTile(stickers: number, lifetimeVolumeKg: number, units: Units): { value: string; sub: string } {
  const value = stickers === 1 ? '1 sticker' : `${stickers} stickers`;
  const animals = lifetimeAnimalLine(lifetimeVolumeKg);
  return { value, sub: animals ? `${formatTotalWeight(lifetimeVolumeKg, units)} lifted, ${animals}` : 'your animals and rare finds' };
}
