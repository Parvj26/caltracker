/**
 * Keeps Tab inside an open sheet whose items aren't all next to each other in the page (the More sheet and the tab
 * bar's More button). Given how many focusable items there are, the index of the focused one (-1 when focus is outside)
 * and whether Shift is held, returns the index to move focus to (wrapping round), or null when there is none.
 */
export function cycleTabTarget(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current === -1) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}
