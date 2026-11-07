// Workouts shared to the community from this phone since the app opened. Today's "Share your workout" button hides
// as soon as the post is created, without waiting for (or needing) the server to say so again.
import { useSyncExternalStore } from 'react';

let shared: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

/** Called by the composer once a workout card was posted. */
export function markWorkoutShared(logId: string): void {
  if (shared.has(logId)) return;
  shared = new Set([...shared, logId]);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The ids of the workout logs shared from this phone. */
export function useSharedWorkouts(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => shared);
}
