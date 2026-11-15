import { formatRelativeInstantDay } from '../dates/format';
import { parseYoutubeUrl } from '../exercises/youtube';

/** "Today", "Yesterday", "Mon 2 Nov", or "Wed 31 Dec 2025" for an earlier year, as days go in `timeZone`. */
export function dayLabel(iso: string, nowIso: string, timeZone: string): string {
  return formatRelativeInstantDay(iso, nowIso, timeZone);
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
