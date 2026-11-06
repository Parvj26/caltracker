// Demo links come from the database (a coach's pinned link or the exercise's own), and from a phone's cache.
// Neither is trusted: only a real YouTube video link is ever opened, and always in its canonical form.
import { canonicalYoutubeUrl, parseYoutubeUrl } from '@caltracker/shared';

const SEARCH_PREFIX = 'https://www.youtube.com/results?search_query=';

/** The canonical https watch link for a YouTube video link, or null for anything else (including null). */
export function demoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = parseYoutubeUrl(raw);
  return parsed ? canonicalYoutubeUrl(parsed.videoId) : null;
}

/** What the "Watch form" button may open: a video link, or the app's own YouTube search for the exercise. */
export function openableDemoUrl(raw: string | null | undefined): string | null {
  return demoUrl(raw) ?? (raw?.startsWith(SEARCH_PREFIX) ? raw : null);
}
