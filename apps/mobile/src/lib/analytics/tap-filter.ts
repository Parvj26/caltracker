/** A touch that moved more than this is a scroll or swipe, not a tap. */
const TAP_SLOP = 10;

export function isTap(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return Math.abs(end.x - start.x) <= TAP_SLOP && Math.abs(end.y - start.y) <= TAP_SLOP;
}
