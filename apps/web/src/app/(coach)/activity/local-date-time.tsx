'use client';

import { formatDateTime } from '@caltracker/shared';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * A timestamp as date and time in the viewer's own time zone ("4 Nov, 11:30 pm"). The server (UTC, on Workers)
 * renders a first guess and the browser re-renders it right after hydration, as LocalDate does. formatDateTime
 * prints the same text on Node and Safari, so the first render matches and there's no hydration error.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatDateTime(iso),
    () => formatDateTime(iso, 'UTC'),
  );
  return <time dateTime={iso}>{text}</time>;
}
