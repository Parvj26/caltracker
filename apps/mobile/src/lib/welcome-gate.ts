// The welcome's live state, shared by WelcomeOverlay (root layout) and the Today tab, which says when its load is
// done. A tiny store (no React context), so Today can report "ready" before or after the overlay subscribes.
import { useSyncExternalStore } from 'react';
import { COLD_START, welcomeStep, type WelcomeEvent, type WelcomeState } from './welcome-logic';

let state: WelcomeState = COLD_START;
let todayMounted = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

function send(event: WelcomeEvent): void {
  const next = welcomeStep(state, event);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

export const welcomeGate = {
  /** Back to the front: shows the welcome again after more than 10 minutes away (when Today is there to load). */
  resumed: (backgroundedAt: number | null, now: number) => send({ type: 'resume', backgroundedAt, now, todayMounted: todayMounted > 0 }),
  /** Today's load is done: the welcome fades into it. */
  todayReady: () => send({ type: 'ready' }),
  noToday: () => send({ type: 'no-today' }),
  timedOut: () => send({ type: 'timeout' }),
  /** Today is on screen (in the tabs); returns its unmount. */
  mountToday: (): (() => void) => {
    todayMounted += 1;
    return () => {
      todayMounted -= 1;
    };
  },
};

export function useWelcomeState(): WelcomeState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
