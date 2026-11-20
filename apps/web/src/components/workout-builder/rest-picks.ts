import { formatClock } from '@caltracker/shared';

/** The Rest box's quick picks: 0:30, 1:00, 1:30 and 2:00. */
export const REST_PICKS = [30, 60, 90, 120] as const;

/** The pick that matches the rest now (shown black), or null when it is none of them. */
export function activeRestPick(restSeconds: number | null): number | null {
  return REST_PICKS.find((p) => p === restSeconds) ?? null;
}

/**
 * The picks show only while the Rest box has focus (on every size), and not for a drop or a superset exercise with
 * no rest box. A tap on a pick never takes focus from the box, so they stay until the coach leaves it.
 */
export function restPicksShown(o: { focused: boolean; hasRestBox: boolean }): boolean {
  return o.focused && o.hasRestBox;
}

export const restPickLabel = (seconds: number) => formatClock(seconds);
