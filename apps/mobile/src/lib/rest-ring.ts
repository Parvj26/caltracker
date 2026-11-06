/** How much of the rest is left, for the countdown ring: 1 = full, 0 = over. Never outside 0..1. */
export function ringFraction(endsAt: number, totalS: number, nowMs: number): number {
  if (totalS <= 0) return 0;
  const f = (endsAt - nowMs) / (totalS * 1000);
  return Math.min(1, Math.max(0, f));
}
