// Tells every screen showing weights that the client switched kg/lb, so they all update at once
// (each screen reads units with its own useUnits hook).
import type { Units } from '@caltracker/shared';

type Listener = (userId: string, units: Units) => void;
const listeners = new Set<Listener>();

export function subscribeUnits(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishUnits(userId: string, units: Units): void {
  for (const l of [...listeners]) l(userId, units);
}
