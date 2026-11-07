// Keeps a fast double tap on ✓ from ticking and then unticking a set. Pure: the screen keeps `last` in a ref.

/** Taps closer together than this are one tap. */
export const REPEAT_MS = 500;

/** The set just ticked or unticked and when (epoch ms). */
export type LastDone = { setId: string; at: number } | null;

/** ✓: a second tap on the same row within the moment is the same tap (it would untick it again). */
export function ignoreTick(last: LastDone, setId: string, now: number): boolean {
  return last !== null && last.setId === setId && now - last.at < REPEAT_MS;
}
