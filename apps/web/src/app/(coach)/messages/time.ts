'use client';

import { useState, useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * The viewer's time zone. The server (UTC) and the first browser render use "UTC" so they match, and the browser
 * switches to its own zone right after hydration.
 */
export function useTimeZone(): string {
  return useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => 'UTC',
  );
}

/** "14:05" in a time zone. */
export function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** An ISO instant for "now" that can be refreshed (e.g. when the window wakes after midnight). */
export function useNow(): [string, () => void] {
  const [now, setNow] = useState(() => new Date().toISOString());
  return [now, () => setNow(new Date().toISOString())];
}
