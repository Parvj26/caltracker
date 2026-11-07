import type { WorkoutLogDoc } from '../logs/schema';
import { completedSetCount } from '../logs/summary';
import { STICKERS } from './catalogue';
import type { StickerDef } from './catalogue';
import type { Rng } from './rolls';

const LADDER = STICKERS.filter((s) => s.kind === 'ladder').sort((a, b) => (a.weightKg ?? 0) - (b.weightKg ?? 0));
const LADDER_BY_KEY = new Map(LADDER.map((s) => [s.key, s]));

export type LadderPick = { sticker: StickerDef; multiple: number };

/** One ladder animal a client was awarded: the log it came with, when that log was finished, and the animal. */
export type LadderAward = { logId: string; finishedAt: string; key: string };

/**
 * A seeded random source in [0, 1): the same seed always gives the same numbers. The seed is hashed with
 * cyrb53-style mixing into a mulberry32 generator, so it runs the same on the phone, the server and in tests.
 */
export function seededRng(seed: string): Rng {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  let state = h1 >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A timestamp as Postgres sends it ("2026-11-07T05:12:19.123456+00:00", or with a space and "+00") turned into an
 * ISO instant every JavaScript engine parses: a "T", at most 3 fractional digits, and "Z" for UTC. Hermes (the
 * phone) can return NaN for microseconds, which would silently break the order of the ladder history.
 */
export function normalizeInstant(ts: string): string {
  return ts
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/(?:\+00(?::?00)?|-00:00)$/, 'Z');
}

/** The instant in ms since the epoch, after normalizeInstant. */
export function instantMs(ts: string): number {
  return Date.parse(normalizeInstant(ts));
}

const atMs = instantMs;

/**
 * The ladder animals a client was awarded for logs finished before `log` (by finish time, then log id), oldest
 * first. Awards of later logs never count, so working an old log out again gives the same answer.
 */
export function ladderHistoryBefore(
  awards: readonly LadderAward[],
  log: { id: string; finishedAt: string },
): string[] {
  const at = atMs(log.finishedAt);
  const before = (a: LadderAward) => {
    const t = atMs(a.finishedAt);
    return t < at || (t === at && a.logId < log.id);
  };
  return awards
    .filter(before)
    .sort((a, b) => atMs(a.finishedAt) - atMs(b.finishedAt) || (a.logId < b.logId ? -1 : a.logId > b.logId ? 1 : 0))
    .map((a) => a.key);
}

/**
 * The ladder animal a workout earns (docs/design/collection.md §1):
 *   1. eligible: every ladder animal weighing at most the volume;
 *   2. one the client has not been awarded yet, at random (seeded by the log id, so always the same one);
 *   3. if they have them all, the one whose last award is the oldest (lighter first on a tie).
 * `history` is the animals awarded before this log, oldest first (ladderHistoryBefore). `keep` is the animal
 * already stored for this log: a workout keeps its animal forever (product owner, 2026-11-07), even when a
 * correction takes the volume below it, so it always comes back, with the multiple of the volume now (maybe under
 * 1). With nothing stored: null below the lightest animal.
 */
export function pickLadderAnimal(
  volumeKg: number,
  history: readonly string[],
  seed: string,
  keep?: string | null,
): LadderPick | null {
  const pick = (sticker: StickerDef): LadderPick => ({ sticker, multiple: volumeKg / (sticker.weightKg ?? 1) });
  const kept = keep ? LADDER_BY_KEY.get(keep) : undefined;
  if (kept) return pick(kept);

  const eligible = LADDER.filter((s) => (s.weightKg ?? Infinity) <= volumeKg);
  if (eligible.length === 0) return null;

  const lastAwarded = new Map<string, number>();
  history.forEach((key, i) => lastAwarded.set(key, i));

  const unowned = eligible.filter((s) => !lastAwarded.has(s.key));
  if (unowned.length > 0) {
    const i = Math.min(unowned.length - 1, Math.floor(seededRng(seed)() * unowned.length));
    return pick(unowned[i]!);
  }
  // `eligible` is lightest first and the sort is stable, so a tie keeps the lighter animal first.
  const oldest = [...eligible].sort((a, b) => (lastAwarded.get(a.key) ?? 0) - (lastAwarded.get(b.key) ?? 0))[0]!;
  return pick(oldest);
}

const SAME_PLURAL = new Set(['bison', 'moose', 'sheep']);

function plural(name: string): string {
  const last = name.split(' ').pop()?.toLowerCase() ?? '';
  if (SAME_PLURAL.has(last)) return name;
  if (last === 'walrus') return `${name}es`;
  return `${name}s`;
}

/**
 * How many of an animal, rounded for people: one decimal under 10, whole numbers from 10 up, thousands grouped.
 * `count` is the number as text ("1", "1.4", "1,500"); `tiny` is true for a sliver above nothing (shown as "< 0.1").
 */
export function animalAmount(multiple: number, name: string): { count: string; noun: string; tiny: boolean } {
  if (multiple > 0 && multiple < 0.05) return { count: '0.1', noun: plural(name), tiny: true };
  const rounded = multiple < 10 ? Math.round(multiple * 10) / 10 : Math.round(multiple);
  const count = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return { count, noun: rounded === 1 ? name : plural(name), tiny: false };
}

/**
 * "≈ 1 Hippo", "≈ 1.4 Hippos": one decimal under 10, whole numbers from 10 up, thousands grouped ("≈ 1,500 Rabbits").
 * Under 1 (a kept animal after a correction): "≈ 0.8 Horses", and "< 0.1 Horses" for a sliver above nothing.
 */
export function formatMultiple(multiple: number, name: string): string {
  const a = animalAmount(multiple, name);
  return a.tiny ? `< ${a.count} ${a.noun}` : `≈ ${a.count} ${a.noun}`;
}

/** A completed workout with at least 5 completed sets: the only kind that gets drop and shiny rolls. */
export function isQualifying(log: WorkoutLogDoc): boolean {
  return log.status === 'completed' && completedSetCount(log) >= 5;
}
