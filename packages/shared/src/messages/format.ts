import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { parseYoutubeUrl } from '../exercises/youtube';

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
function dateInZone(iso: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    numberingSystem: 'latn',
  }).formatToParts(new Date(iso));
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  return `${String(part('year')).padStart(4, '0')}-${String(part('month')).padStart(2, '0')}-${String(part('day')).padStart(2, '0')}`;
}

/** "Today", "Yesterday", "Mon 2 Nov", or "Wed 31 Dec 2025" for an earlier year. */
export function dayLabel(iso: string, nowIso: string, timeZone: string): string {
  const day = dateInZone(iso, timeZone);
  const today = dateInZone(nowIso, timeZone);
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone,
  })
    .format(new Date(iso))
    .replace(/,/g, '');
}

/** Distinct YouTube video ids linked in a message, in order of appearance. */
export function messageYoutubeIds(body: string): string[] {
  const ids: string[] = [];
  for (const token of body.split(/\s+/)) {
    const cleaned = token.replace(/^[(<[]+|[)>\].,;!?]+$/g, '');
    const id = parseYoutubeUrl(cleaned)?.videoId;
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
