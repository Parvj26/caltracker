'use client';

import { useSyncExternalStore } from 'react';
import { agoLabel, dateLabel, sinceLabel, whenLabel } from '@/lib/format';

const noop = () => () => {};

/**
 * A time in the admin's own time zone. The server renders the UTC date; the browser swaps in the local wording after
 * hydration (relative times need the browser's clock and zone).
 */
export function LocalTime({ iso, kind }: { iso: string | null | undefined; kind: 'ago' | 'since' | 'when' | 'date' | 'datetime' }) {
  const onClient = useSyncExternalStore(noop, () => true, () => false);
  if (!iso) return <>{kind === 'ago' ? 'never' : '—'}</>;
  const zone = onClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const now = new Date();
  let text: string;
  switch (kind) {
    case 'ago':
      text = onClient ? agoLabel(iso, now) : dateLabel(iso, zone);
      break;
    case 'since':
      text = sinceLabel(iso, now);
      break;
    case 'when':
      text = whenLabel(iso, now, zone);
      break;
    case 'date':
      text = dateLabel(iso, zone);
      break;
    case 'datetime':
      text = `${dateLabel(iso, zone)}, ${new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}`;
      break;
  }
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
