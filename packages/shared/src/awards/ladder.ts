import type { WorkoutLogDoc } from '../logs/schema';
import { completedSetCount } from '../logs/summary';
import { STICKERS } from './catalogue';
import type { StickerDef } from './catalogue';

const LADDER = STICKERS.filter((s) => s.kind === 'ladder').sort((a, b) => (a.weightKg ?? 0) - (b.weightKg ?? 0));

/** The heaviest ladder animal whose weight is at most the volume, and how many of it the volume is. */
export function ladderAnimal(volumeKg: number): { sticker: StickerDef; multiple: number } | null {
  let found: StickerDef | null = null;
  for (const s of LADDER) if ((s.weightKg ?? Infinity) <= volumeKg) found = s;
  if (!found || !found.weightKg) return null;
  return { sticker: found, multiple: volumeKg / found.weightKg };
}

const SAME_PLURAL = new Set(['bison', 'moose', 'sheep']);

function plural(name: string): string {
  const last = name.split(' ').pop()?.toLowerCase() ?? '';
  if (SAME_PLURAL.has(last)) return name;
  if (last === 'walrus') return `${name}es`;
  return `${name}s`;
}

/** "≈ 1 Hippo", "≈ 1.4 Hippos": one decimal under 10, whole numbers from 10 up. */
export function formatMultiple(multiple: number, name: string): string {
  const rounded = multiple < 10 ? Math.round(multiple * 10) / 10 : Math.round(multiple);
  const text = rounded === 1 ? '1' : String(rounded);
  return `≈ ${text} ${rounded === 1 ? name : plural(name)}`;
}

/** A completed workout with at least 5 completed sets: the only kind that gets drop and shiny rolls. */
export function isQualifying(log: WorkoutLogDoc): boolean {
  return log.status === 'completed' && completedSetCount(log) >= 5;
}
