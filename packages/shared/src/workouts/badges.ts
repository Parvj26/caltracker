import type { BlockKind } from './schema';

/** A superset's letter by its place among the workout's supersets: A … Z, then AA, AB … (a workout holds ≤ 30 blocks). */
export function supersetLetter(n: number): string {
  return n < 26 ? String.fromCharCode(65 + n) : `${supersetLetter(Math.floor(n / 26) - 1)}${supersetLetter(n % 26)}`;
}

/**
 * The badge on each card of a workout, block by block, in the order the coach sees them (the coach builder's list,
 * editor and Reorder all use this, so they always agree).
 *
 * Every block is one step of the workout and counts once, so a single exercise or a pick-one group shows its step
 * number ("3"). A superset's exercises show the superset's letter plus their place in it ("A1", "A2"); the letter
 * goes by the superset's order among supersets, as the client app labels them. So 1, A1, A2, 3 and A1, A2, 2: the
 * numbering never restarts after a superset.
 */
export function blockBadges(blocks: ReadonlyArray<{ kind: BlockKind; exercises: ReadonlyArray<unknown> }>): string[][] {
  let supersets = 0;
  return blocks.map((block, i) => {
    if (block.kind !== 'superset') return [String(i + 1)];
    const letter = supersetLetter(supersets++);
    return block.exercises.map((_, ei) => `${letter}${ei + 1}`);
  });
}
