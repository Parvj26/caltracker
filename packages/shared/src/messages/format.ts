import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { parseYoutubeUrl } from '../exercises/youtube';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Numeric calendar parts of an instant in a time zone. Only numbers are taken from Intl (limited locale data on Hermes). */
function partsInZone(iso: string, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    numberingSystem: 'latn',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

function isoOf(p: { year: number; month: number; day: number }): IsoDate {
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "Today", "Yesterday", "Mon 2 Nov", or "Wed 31 Dec 2025" for an earlier year. */
export function dayLabel(iso: string, nowIso: string, timeZone: string): string {
  const day = partsInZone(iso, timeZone);
  const today = partsInZone(nowIso, timeZone);
  if (isoOf(day) === isoOf(today)) return 'Today';
  if (isoOf(day) === addDays(isoOf(today), -1)) return 'Yesterday';
  const label = `${WEEKDAYS[day.weekday]} ${day.day} ${MONTHS[day.month - 1]}`;
  return day.year === today.year ? label : `${label} ${day.year}`;
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
