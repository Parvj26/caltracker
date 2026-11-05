'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const format = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/**
 * A timestamp as a date in the viewer's own time zone. The server (UTC, on Workers) renders a first guess and the
 * browser re-renders it right after hydration, so a coach in Los Angeles at 9 pm doesn't see tomorrow's date.
 */
export function LocalDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso),
    () => format(iso, 'UTC'),
  );
  return <time dateTime={iso}>{text}</time>;
}
