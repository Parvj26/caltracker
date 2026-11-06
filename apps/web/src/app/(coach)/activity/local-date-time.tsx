'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const format = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(iso),
  );

/**
 * A timestamp as date and time in the viewer's own time zone ("4 Nov, 11:30 pm"). The server (UTC, on Workers)
 * renders a first guess and the browser re-renders it right after hydration, as LocalDate does.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso),
    () => format(iso, 'UTC'),
  );
  return <time dateTime={iso}>{text}</time>;
}
