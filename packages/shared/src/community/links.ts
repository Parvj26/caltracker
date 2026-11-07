import { parseYoutubeUrl } from '../exercises/youtube';

export type TextSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

// http(s) links and bare www. links. Trailing punctuation is left out of the link ("see example.com.").
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING = /[.,;:!?'")\]]+$/;

/** Splits post text into plain text and links (only http and https ever become links). */
export function splitLinks(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    let raw = m[0];
    const trail = raw.match(TRAILING)?.[0] ?? '';
    if (trail) raw = raw.slice(0, raw.length - trail.length);
    if (!raw) continue;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'link', text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The first YouTube video linked in the text, for a preview that plays on YouTube. */
export function firstYoutubeId(text: string): string | null {
  for (const s of splitLinks(text)) {
    if (s.kind !== 'link') continue;
    const parsed = parseYoutubeUrl(s.href);
    if (parsed) return parsed.videoId;
  }
  return null;
}
