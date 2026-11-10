/**
 * Keeps Tab inside an open dialog. Given how many focusable items it has, the index of the focused one (-1 when focus
 * is outside it) and whether Shift is held, returns the index to move focus to, or null to let the browser move it.
 */
export function trapTabTarget(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null;
  const last = count - 1;
  if (current === -1) return backwards ? last : 0;
  if (!backwards && current === last) return 0;
  if (backwards && current === 0) return last;
  return null;
}
