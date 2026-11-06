import { STICKERS } from './catalogue';

/** A random source returning [0, 1). The server passes a CSPRNG-backed one; tests pass a fixed one. */
export type Rng = () => number;

export const SHINY_CHANCE = 1 / 20;
export const DROP_CHANCE = 1 / 100;

const DROPS = STICKERS.filter((s) => s.kind === 'drop').map((s) => s.key);

// `<=` so a roll of exactly the chance counts as a hit: the odds differ by one value in billions.
export function rollShiny(rng: Rng): boolean {
  return rng() <= SHINY_CHANCE;
}

/** A surprise drop among those not yet owned, or null (no hit, or all owned). */
export function rollDrop(rng: Rng, owned: ReadonlySet<string>): string | null {
  const left = DROPS.filter((k) => !owned.has(k));
  if (left.length === 0 || rng() > DROP_CHANCE) return null;
  return left[Math.min(left.length - 1, Math.floor(rng() * left.length))] ?? null;
}
