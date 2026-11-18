'use client';

import { formatDayDate } from '@caltracker/shared';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

const trim = (text: string, short: boolean) => (short ? text.replace(new RegExp(` ${new Date().getFullYear()}$`), '') : text);

/**
 * A timestamp as a date in the viewer's own time zone ("4 Nov 2026"). The server (UTC, on Workers) renders a first
 * guess and the browser re-renders it right after hydration, so a coach in Los Angeles at 9 pm doesn't see tomorrow's
 * date. formatDayDate prints the same text on Node and Safari ("Sep", never "Sept").
 */
export function LocalDate({ iso, short = false }: { iso: string; /** Leave out this year's year ("4 Nov"). */ short?: boolean }) {
  const text = useSyncExternalStore(
    subscribe,
    () => trim(formatDayDate(iso), short),
    () => trim(formatDayDate(iso, 'UTC'), short),
  );
  return <time dateTime={iso}>{text}</time>;
}
