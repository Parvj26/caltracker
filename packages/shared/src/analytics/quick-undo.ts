/** Deleting or changing something within this long of making it counts as a quick undo. */
export const QUICK_UNDO_MS = 30_000;

export function isQuickUndo(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs <= QUICK_UNDO_MS;
}
