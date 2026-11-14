'use client';

import { formatDayDate } from '@caltracker/shared';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * A timestamp as a date in the viewer's own time zone ("4 Nov 2026"). The server (UTC, on Workers) renders a first
 * guess and the browser re-renders it right after hydration, so a coach in Los Angeles at 9 pm doesn't see tomorrow's
 * date. formatDayDate prints the same text on Node and Safari ("Sep", never "Sept").
 */
export function LocalDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatDayDate(iso),
    () => formatDayDate(iso, 'UTC'),
  );
  return <time dateTime={iso}>{text}</time>;
}
