import { useSyncExternalStore } from 'react';
import { localToday } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';

/** Milliseconds from `now` to the next midnight in the browser's own time zone. */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * Calls `onChange` just after each local midnight, and whenever the tab becomes visible or gets focus (a sleeping
 * laptop may not run timers on time). Returns the unsubscribe function.
 */
export function subscribeToDayChange(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    // A second past midnight, so the date has surely changed when it fires.
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, msUntilNextLocalMidnight(new Date()) + 1000);
  };
  const wake = () => {
    onChange();
    schedule();
  };
  schedule();
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
  };
}

/**
 * Today in the coach's browser, kept current across midnight. The server (UTC on Workers) renders UTC's date first
 * and the browser corrects it right after hydration, so a coach in Auckland or Los Angeles sees their own date.
 */
export function useLocalToday(): IsoDate {
  return useSyncExternalStore(subscribeToDayChange, () => localToday(), () => localToday('UTC'));
}
