// Keeps a fast double tap from completing two sets. Pure: the screen keeps `last` in a ref.

/** Taps closer together than this are one tap. */
export const REPEAT_MS = 500;

/** The set just completed and when (epoch ms). */
export type LastDone = { setId: string; at: number } | null;

/**
 * Done: ignored while the screen still shows the set just completed (it hasn't redrawn yet), and for a moment after
 * any completion, because with no rest the next step (a drop, A2, the next set) is on screen at once.
 */
export function ignoreDone(last: LastDone, currentSetId: string, now: number): boolean {
  if (last === null) return false;
  return currentSetId === last.setId || now - last.at < REPEAT_MS;
}

/** Edit sets ✓: a second tap on the same row within the moment is the same tap (it would untick it again). */
export function ignoreTick(last: LastDone, setId: string, now: number): boolean {
  return last !== null && last.setId === setId && now - last.at < REPEAT_MS;
}
