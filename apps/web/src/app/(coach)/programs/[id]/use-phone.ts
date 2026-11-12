'use client';

import { useSyncExternalStore } from 'react';

/** The coach app's phone width (same as the side menu turning into the Menu sheet). */
export const PHONE_QUERY = '(max-width: 599.98px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * True on a phone-width screen. The server (and the first paint) render the wide layout; the CSS hides the parts a
 * phone never shows, so nothing too wide flashes up before this switches.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
