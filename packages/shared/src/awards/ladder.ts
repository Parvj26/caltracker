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

const atMs = (iso: string) => Date.parse(iso);

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
 * already stored for this log: it stays as long as the volume still reaches it. Null below the lightest animal.
 */
export function pickLadderAnimal(
  volumeKg: number,
  history: readonly string[],
  seed: string,
  keep?: string | null,
): LadderPick | null {
  const pick = (sticker: StickerDef): LadderPick => ({ sticker, multiple: volumeKg / (sticker.weightKg ?? 1) });
  const eligible = LADDER.filter((s) => (s.weightKg ?? Infinity) <= volumeKg);
  if (eligible.length === 0) return null;

  const kept = keep ? LADDER_BY_KEY.get(keep) : undefined;
  if (kept && eligible.includes(kept)) return pick(kept);

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

/** "≈ 1 Hippo", "≈ 1.4 Hippos": one decimal under 10, whole numbers from 10 up, thousands grouped ("≈ 1,500 Rabbits"). */
export function formatMultiple(multiple: number, name: string): string {
  const rounded = multiple < 10 ? Math.round(multiple * 10) / 10 : Math.round(multiple);
  const text = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `≈ ${text} ${rounded === 1 ? name : plural(name)}`;
}

/** A completed workout with at least 5 completed sets: the only kind that gets drop and shiny rolls. */
export function isQualifying(log: WorkoutLogDoc): boolean {
  return log.status === 'completed' && completedSetCount(log) >= 5;
}
