import type { SetType } from './schema';

const LEADING_DROP = 'A drop set must follow a normal or warm-up set.';

/** Groups each non-drop set with the drop sets that follow it. */
export function groupDropSets<T extends { setType: SetType }>(sets: readonly T[]): Array<{ set: T; drops: T[] }> {
  const groups: Array<{ set: T; drops: T[] }> = [];
  for (const set of sets) {
    if (set.setType === 'drop') {
      const last = groups[groups.length - 1];
      if (!last) throw new Error(LEADING_DROP);
      last.drops.push(set);
    } else {
      groups.push({ set, drops: [] });
    }
  }
  return groups;
}

/**
 * Row labels, the same letters as the builder's set types: warm-ups 'W', sets to failure 'F', drops 'D', other sets
 * numbered from 1. A normal set to failure still counts, so the sets after it keep their numbers.
 */
export function setLabels(sets: readonly { setType: SetType; toFailure?: boolean }[]): string[] {
  let n = 0;
  return sets.map((s) => {
    if (s.setType === 'warmup') return 'W';
    if (s.setType !== 'drop') n += 1;
    if (s.toFailure) return 'F';
    return s.setType === 'drop' ? 'D' : String(n);
  });
}
